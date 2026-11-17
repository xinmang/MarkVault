package server

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	// 精简镜像（scratch、slim）可能不带系统时区库，内置后按 IANA 时区统计才可靠。
	_ "time/tzdata"
)

const (
	analyticsMaxDays    = 3660
	analyticsStamp      = "2006-01-02T15:04:05.000Z"
	analyticsDateLayout = "2006-01-02"
)

// tzSegment 是统计区间内 UTC 偏移不变的一段：[start,end) 为 UTC 时间戳，modifier 交给 SQLite 换算本地时间。
type tzSegment struct {
	start, end, modifier string
}

type analyticsRequest struct {
	loc         *time.Location
	tz          string
	start, end  time.Time // 本地自然日，统一用 UTC 零点表示，日期加减不受夏令时影响
	allTime     bool
	granularity string
	limit       int
	tagID       string
	bookmarkID  string
}

func civilDate(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// localMidnight 返回自然日 day 在 loc 时区开始的时刻；零点被夏令时跳过时由 time.Date 顺延。
func localMidnight(day time.Time, loc *time.Location) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
}

func spanDays(start, end time.Time) int { return int(end.Sub(start).Hours()/24) + 1 }

func utcStamp(t time.Time) string { return t.UTC().Format(analyticsStamp) }

func parseAnalyticsDate(raw string) (time.Time, error) {
	day, err := time.Parse(analyticsDateLayout, raw)
	if err != nil || day.Year() < 1970 || day.Year() > 9998 {
		return time.Time{}, problem(400, "日期必须为 1970–9998 年之间的 YYYY-MM-DD")
	}
	return day, nil
}

func parseAnalyticsRequest(r *http.Request, now time.Time) (analyticsRequest, error) {
	q := r.URL.Query()
	req := analyticsRequest{loc: time.UTC, tz: "UTC", granularity: "day", limit: 10}
	if raw := strings.TrimSpace(q.Get("tz")); raw != "" {
		// Local 取决于服务器配置，不能作为用户时区。
		if len(raw) > 64 || raw == "Local" {
			return req, problem(400, "时区无效，请使用 IANA 时区名，例如 Asia/Shanghai")
		}
		loc, err := time.LoadLocation(raw)
		if err != nil {
			return req, problem(400, "时区无效，请使用 IANA 时区名，例如 Asia/Shanghai")
		}
		req.loc, req.tz = loc, raw
	}
	switch value := q.Get("granularity"); value {
	case "", "day":
	case "week", "month":
		req.granularity = value
	default:
		return req, problem(400, "统计粒度只能是 day、week 或 month")
	}
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			return req, problem(400, "limit 必须在 1 到 50 之间")
		}
		req.limit = n
	}
	for key, target := range map[string]*string{"tag_id": &req.tagID, "bookmark_id": &req.bookmarkID} {
		if raw := q.Get(key); raw != "" {
			if len(raw) > 128 {
				return req, problem(400, key+" 无效")
			}
			*target = raw
		}
	}
	req.end = civilDate(now.In(req.loc))
	if raw := q.Get("end_date"); raw != "" {
		day, err := parseAnalyticsDate(raw)
		if err != nil {
			return req, err
		}
		req.end = day
	}
	raw := q.Get("start_date")
	if raw == "" {
		// 起点由最早的点击记录决定，见 resolveAllTime。
		req.allTime = true
		req.start = req.end
		return req, nil
	}
	day, err := parseAnalyticsDate(raw)
	if err != nil {
		return req, err
	}
	if day.After(req.end) {
		return req, problem(400, "开始日期不能晚于结束日期")
	}
	if spanDays(day, req.end) > analyticsMaxDays {
		return req, problem(400, fmt.Sprintf("统计区间最长 %d 天", analyticsMaxDays))
	}
	req.start = day
	return req, nil
}

// zoneSegments 把 [from,to) 按时区偏移变化切段，夏令时切换前后的点击都能换算到正确的本地日期。
func zoneSegments(loc *time.Location, from, to time.Time) []tzSegment {
	segments := []tzSegment{}
	for at := from; at.Before(to); {
		local := at.In(loc)
		_, offset := local.Zone()
		_, next := local.ZoneBounds()
		end := to
		if !next.IsZero() && next.After(at) && next.Before(to) {
			end = next
		}
		segments = append(segments, tzSegment{utcStamp(at), utcStamp(end), fmt.Sprintf("%+d seconds", offset)})
		at = end
	}
	return segments
}

func segmentCTE(segments []tzSegment) (string, []any) {
	rows := make([]string, 0, len(segments))
	args := make([]any, 0, len(segments)*3)
	for _, segment := range segments {
		rows = append(rows, "(?,?,?)")
		args = append(args, segment.start, segment.end, segment.modifier)
	}
	return "WITH seg(s,e,m) AS (VALUES " + strings.Join(rows, ",") + ") ", args
}

// analyticsBucketKey 返回某天所属的统计桶：日、所在周的周一或 YYYY-MM。
func analyticsBucketKey(day time.Time, granularity string) string {
	switch granularity {
	case "week":
		return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7)).Format(analyticsDateLayout)
	case "month":
		return day.Format("2006-01")
	}
	return day.Format(analyticsDateLayout)
}

// analyticsBuckets 覆盖整个区间并以 0 补齐，桶的起止日期按区间裁剪。
func analyticsBuckets(start, end time.Time, granularity string, bookmarkDaily, tagDaily map[string]int64) []object {
	buckets := []object{}
	index := map[string]int{}
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		key := analyticsBucketKey(day, granularity)
		date := day.Format(analyticsDateLayout)
		position, ok := index[key]
		if !ok {
			position = len(buckets)
			index[key] = position
			buckets = append(buckets, object{"bucket": key, "start_date": date, "end_date": date, "bookmark_clicks": int64(0), "tag_clicks": int64(0)})
		}
		bucket := buckets[position]
		bucket["end_date"] = date
		bucket["bookmark_clicks"] = bucket["bookmark_clicks"].(int64) + bookmarkDaily[date]
		bucket["tag_clicks"] = bucket["tag_clicks"].(int64) + tagDaily[date]
	}
	return buckets
}

func clickDomain(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

// rankDomains 由区间内的书签点击汇总域名排行。
func rankDomains(bookmarks []object, limit int) []object {
	clicks := map[string]int64{}
	counts := map[string]int64{}
	for _, row := range bookmarks {
		domain := clickDomain(str(row["url"]))
		if domain == "" {
			continue
		}
		clicks[domain] += number(row["clicks"])
		counts[domain]++
	}
	result := make([]object, 0, len(clicks))
	for domain, total := range clicks {
		result = append(result, object{"domain": domain, "clicks": total, "bookmarks": counts[domain]})
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i]["clicks"].(int64), result[j]["clicks"].(int64)
		if a == b {
			return str(result[i]["domain"]) < str(result[j]["domain"])
		}
		return a > b
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

// resolveAllTime 以最早的点击记录作为“全部时间”的起点，并限制最大跨度。
func (s *Server) resolveAllTime(r *http.Request, req *analyticsRequest) (any, error) {
	var first any
	err := s.db.QueryRowContext(r.Context(), "SELECT MIN(v) FROM (SELECT MIN(clicked_at) AS v FROM bookmark_click_events WHERE user_id=? UNION ALL SELECT MIN(clicked_at) FROM tag_click_events WHERE user_id=?)", userID(r), userID(r)).Scan(&first)
	if err != nil {
		return nil, err
	}
	stamp, err := time.Parse(time.RFC3339Nano, fmt.Sprint(first))
	if first == nil || err != nil {
		return nil, nil
	}
	date := civilDate(stamp.In(req.loc))
	if req.allTime {
		earliest := req.end.AddDate(0, 0, -(analyticsMaxDays - 1))
		switch {
		case date.After(req.end):
			req.start = req.end
		case date.Before(earliest):
			req.start = earliest
		default:
			req.start = date
		}
	}
	return date.Format(analyticsDateLayout), nil
}

func (s *Server) clickAnalytics(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.statistics"); err != nil {
		return err
	}
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	tagsAvailable := permit(r, "tags.read") == nil
	req, err := parseAnalyticsRequest(r, time.Now())
	if err != nil {
		return err
	}
	if req.tagID != "" && !tagsAvailable {
		return permit(r, "tags.read")
	}
	// SQLite 只有一个连接，聚合查询需要限制频率，避免拖慢其他请求。
	if err := s.rate(r, w, "analytics:"+userID(r), 120, 60); err != nil {
		return err
	}
	uid := userID(r)
	filters := object{"tag": nil, "bookmark": nil}
	if req.tagID != "" {
		tag, err := one(r, s.db, "SELECT id,name,color FROM tags WHERE id=? AND user_id=? AND deleted_at IS NULL", req.tagID, uid)
		if err != nil {
			return err
		}
		filters["tag"] = tag
	}
	if req.bookmarkID != "" {
		bookmark, err := one(r, s.db, "SELECT id,title,url FROM bookmarks WHERE id=? AND user_id=? AND deleted_at IS NULL", req.bookmarkID, uid)
		if err != nil {
			return err
		}
		filters["bookmark"] = bookmark
	}
	firstEvent, err := s.resolveAllTime(r, &req)
	if err != nil {
		return err
	}
	days := spanDays(req.start, req.end)
	from := localMidnight(req.start, req.loc)
	to := localMidnight(req.end.AddDate(0, 0, 1), req.loc)
	previousStart := req.start.AddDate(0, 0, -days)
	previousEnd := req.start.AddDate(0, 0, -1)
	previousFrom := localMidnight(previousStart, req.loc)
	cte, cteArgs := segmentCTE(zoneSegments(req.loc, from, to))

	bookmarkWhere := func(from, to string) (string, []any) {
		where := "e.user_id=? AND e.clicked_at>=? AND e.clicked_at<? AND b.deleted_at IS NULL"
		args := []any{uid, from, to}
		if req.tagID != "" {
			where += " AND EXISTS(SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id=b.id AND bt.user_id=b.user_id AND bt.tag_id=?)"
			args = append(args, req.tagID)
		}
		if req.bookmarkID != "" {
			where += " AND b.id=?"
			args = append(args, req.bookmarkID)
		}
		return where, args
	}
	const bookmarkEvents = " FROM bookmark_click_events e JOIN bookmarks b ON b.id=e.bookmark_id AND b.user_id=e.user_id"

	where, args := bookmarkWhere(utcStamp(from), utcStamp(to))
	clicked, err := all(r, s.db, "SELECT b.id,b.title,b.url,b.favicon,COUNT(*) AS clicks,MAX(e.clicked_at) AS last_clicked_at"+bookmarkEvents+" WHERE "+where+" GROUP BY b.id ORDER BY clicks DESC,last_clicked_at DESC,b.id", args...)
	if err != nil {
		return err
	}
	slots, err := all(r, s.db, cte+"SELECT strftime('%Y-%m-%d %H',e.clicked_at,seg.m) AS slot,COUNT(*) AS clicks"+bookmarkEvents+" JOIN seg ON e.clicked_at>=seg.s AND e.clicked_at<seg.e WHERE "+where+" GROUP BY slot", append(cteArgs, args...)...)
	if err != nil {
		return err
	}
	previousWhere, previousArgs := bookmarkWhere(utcStamp(previousFrom), utcStamp(from))
	var previousBookmarkClicks int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*)"+bookmarkEvents+" WHERE "+previousWhere, previousArgs...).Scan(&previousBookmarkClicks); err != nil {
		return err
	}

	var bookmarkClicks int64
	for _, row := range clicked {
		bookmarkClicks += number(row["clicks"])
	}
	bookmarkDaily := map[string]int64{}
	heatmap := make([][]int64, 7)
	for i := range heatmap {
		heatmap[i] = make([]int64, 24)
	}
	for _, row := range slots {
		slot := str(row["slot"])
		day, err := time.Parse(analyticsDateLayout, slot[:min(len(slot), 10)])
		hour, hourErr := strconv.Atoi(strings.TrimSpace(slot[min(len(slot), 10):]))
		if err != nil || hourErr != nil || hour < 0 || hour > 23 {
			continue
		}
		count := number(row["clicks"])
		bookmarkDaily[day.Format(analyticsDateLayout)] += count
		heatmap[day.Weekday()][hour] += count
	}

	topBookmarks := clicked
	if len(topBookmarks) > req.limit {
		topBookmarks = topBookmarks[:req.limit]
	}
	if err := s.attachRankTags(r, topBookmarks, tagsAvailable); err != nil {
		return err
	}
	s.signBookmarkImages(uid, topBookmarks, "owner")

	tagDaily := map[string]int64{}
	topTags := []object{}
	var tagClicks, previousTagClicks int64
	tagsClicked := 0
	if tagsAvailable && req.bookmarkID == "" {
		tagWhere := func(from, to string) (string, []any) {
			where := "e.user_id=? AND e.clicked_at>=? AND e.clicked_at<? AND t.deleted_at IS NULL"
			args := []any{uid, from, to}
			if req.tagID != "" {
				where += " AND t.id=?"
				args = append(args, req.tagID)
			}
			return where, args
		}
		const tagEvents = " FROM tag_click_events e JOIN tags t ON t.id=e.tag_id AND t.user_id=e.user_id"
		where, args := tagWhere(utcStamp(from), utcStamp(to))
		tags, err := all(r, s.db, "SELECT t.id,t.name,t.color,t.icon,COUNT(*) AS clicks,MAX(e.clicked_at) AS last_clicked_at"+tagEvents+" WHERE "+where+" GROUP BY t.id ORDER BY clicks DESC,last_clicked_at DESC,t.id", args...)
		if err != nil {
			return err
		}
		daily, err := all(r, s.db, cte+"SELECT date(e.clicked_at,seg.m) AS day,COUNT(*) AS clicks"+tagEvents+" JOIN seg ON e.clicked_at>=seg.s AND e.clicked_at<seg.e WHERE "+where+" GROUP BY day", append(cteArgs, args...)...)
		if err != nil {
			return err
		}
		previousWhere, previousArgs := tagWhere(utcStamp(previousFrom), utcStamp(from))
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*)"+tagEvents+" WHERE "+previousWhere, previousArgs...).Scan(&previousTagClicks); err != nil {
			return err
		}
		for _, row := range tags {
			tagClicks += number(row["clicks"])
		}
		for _, row := range daily {
			tagDaily[str(row["day"])] += number(row["clicks"])
		}
		tagsClicked = len(tags)
		topTags = tags
		if len(topTags) > req.limit {
			topTags = topTags[:req.limit]
		}
		if err := s.attachTagBookmarkCounts(r, topTags); err != nil {
			return err
		}
	}

	activeDays := 0
	var peak object
	for day := req.start; !day.After(req.end); day = day.AddDate(0, 0, 1) {
		date := day.Format(analyticsDateLayout)
		total := bookmarkDaily[date] + tagDaily[date]
		if total == 0 {
			continue
		}
		activeDays++
		// 并列时取较近的一天。
		if peak == nil || total >= peak["bookmark_clicks"].(int64)+peak["tag_clicks"].(int64) {
			peak = object{"date": date, "bookmark_clicks": bookmarkDaily[date], "tag_clicks": tagDaily[date]}
		}
	}
	summary := object{
		"bookmark_clicks":   bookmarkClicks,
		"tag_clicks":        tagClicks,
		"bookmarks_clicked": len(clicked),
		"tags_clicked":      tagsClicked,
		"active_days":       activeDays,
		"peak_day":          peak,
		"previous": object{
			"start_date":      previousStart.Format(analyticsDateLayout),
			"end_date":        previousEnd.Format(analyticsDateLayout),
			"bookmark_clicks": previousBookmarkClicks,
			"tag_clicks":      previousTagClicks,
		},
	}
	return success(w, object{
		"range": object{
			"start_date":  req.start.Format(analyticsDateLayout),
			"end_date":    req.end.Format(analyticsDateLayout),
			"tz":          req.tz,
			"granularity": req.granularity,
			"days":        days,
			"all_time":    req.allTime,
		},
		"filters":          filters,
		"first_event_date": firstEvent,
		"summary":          summary,
		"trend":            analyticsBuckets(req.start, req.end, req.granularity, bookmarkDaily, tagDaily),
		"top_bookmarks":    topBookmarks,
		"top_tags":         topTags,
		"top_domains":      rankDomains(clicked, req.limit),
		"heatmap":          heatmap,
		"tags_available":   tagsAvailable,
	})
}

// attachRankTags 为排行中的书签附上当前标签；API Key 无 tags.read 时不暴露标签名。
func (s *Server) attachRankTags(r *http.Request, rows []object, tagsAvailable bool) error {
	byID := map[string]object{}
	args := []any{userID(r)}
	for _, row := range rows {
		row["tags"] = []object{}
		byID[str(row["id"])] = row
		args = append(args, row["id"])
	}
	if len(rows) == 0 || !tagsAvailable {
		return nil
	}
	tags, err := all(r, s.db, "SELECT bt.bookmark_id,t.id,t.name,t.color FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id AND t.user_id=bt.user_id WHERE bt.user_id=? AND t.deleted_at IS NULL AND bt.bookmark_id IN ("+placeholders(len(rows))+") ORDER BY lower(t.name),t.id", args...)
	if err != nil {
		return err
	}
	for _, tag := range tags {
		row := byID[str(tag["bookmark_id"])]
		delete(tag, "bookmark_id")
		row["tags"] = append(row["tags"].([]object), tag)
	}
	return nil
}

// attachTagBookmarkCounts 统计排行标签当前关联的未删除书签数。
func (s *Server) attachTagBookmarkCounts(r *http.Request, rows []object) error {
	if len(rows) == 0 {
		return nil
	}
	byID := map[string]object{}
	args := []any{userID(r)}
	for _, row := range rows {
		row["bookmark_count"] = int64(0)
		byID[str(row["id"])] = row
		args = append(args, row["id"])
	}
	counts, err := all(r, s.db, "SELECT bt.tag_id,COUNT(*) AS n FROM bookmark_tags bt JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=bt.user_id WHERE bt.user_id=? AND b.deleted_at IS NULL AND bt.tag_id IN ("+placeholders(len(rows))+") GROUP BY bt.tag_id", args...)
	if err != nil {
		return err
	}
	for _, count := range counts {
		if row := byID[str(count["tag_id"])]; row != nil {
			row["bookmark_count"] = number(count["n"])
		}
	}
	return nil
}
