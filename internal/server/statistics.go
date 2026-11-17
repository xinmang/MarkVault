package server

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"
)

func topDomains(rows []object) []object {
	counts := map[string]int{}
	for _, row := range rows {
		if u, err := url.Parse(str(row["url"])); err == nil && u.Hostname() != "" {
			counts[u.Hostname()]++
		}
	}
	result := []object{}
	for domain, count := range counts {
		result = append(result, object{"domain": domain, "count": count})
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i]["count"].(int), result[j]["count"].(int)
		if a == b {
			return str(result[i]["domain"]) < str(result[j]["domain"])
		}
		return a > b
	})
	if len(result) > 10 {
		result = result[:10]
	}
	return result
}
func dateFilter(r *http.Request, field string) (string, []any, error) {
	where := ""
	args := []any{}
	var start, end time.Time
	for _, key := range []string{"start_date", "end_date"} {
		raw := r.URL.Query().Get(key)
		if raw == "" {
			continue
		}
		stamp, err := time.Parse("2006-01-02", raw)
		if err != nil {
			return "", nil, problem(400, "日期必须为 YYYY-MM-DD")
		}
		op := ">="
		if key == "end_date" {
			op = "<="
			end = stamp
		} else {
			start = stamp
		}
		where += " AND date(" + field + ")" + op + "?"
		args = append(args, raw)
	}
	if !start.IsZero() && !end.IsZero() && start.After(end) {
		return "", nil, problem(400, "开始日期不能晚于结束日期")
	}
	return where, args, nil
}
func (s *Server) bookmarkStatistics(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.statistics"); err != nil {
		return err
	}
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	granularity := r.URL.Query().Get("granularity")
	formats := map[string]string{"": "%Y-%m-%d", "day": "%Y-%m-%d", "week": "%Y-W%W", "month": "%Y-%m", "year": "%Y"}
	format, ok := formats[granularity]
	if !ok {
		return problem(400, "未知统计粒度")
	}
	summary, err := one(r, s.db, "SELECT COUNT(*) AS total_bookmarks,COALESCE(SUM(click_count),0) AS total_clicks,COALESCE(SUM(is_public),0) AS public_bookmarks,(SELECT COUNT(*) FROM tags WHERE user_id=? AND deleted_at IS NULL) AS total_tags FROM bookmarks WHERE user_id=? AND deleted_at IS NULL", userID(r), userID(r))
	if err != nil {
		return err
	}
	payload := object{"summary": summary}
	queries := map[string]string{
		"top_bookmarks": "SELECT id,title,url,click_count,last_clicked_at FROM bookmarks WHERE user_id=? AND deleted_at IS NULL AND click_count>0 ORDER BY click_count DESC,last_clicked_at DESC LIMIT 10",
		"recent_clicks": "SELECT id,title,url,last_clicked_at FROM bookmarks WHERE user_id=? AND deleted_at IS NULL AND last_clicked_at IS NOT NULL ORDER BY last_clicked_at DESC LIMIT 10",
		"top_tags":      `SELECT t.id,t.name,t.color,t.click_count,COUNT(b.id) AS bookmark_count FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id=t.id AND bt.user_id=t.user_id LEFT JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=t.user_id AND b.deleted_at IS NULL WHERE t.user_id=? AND t.deleted_at IS NULL GROUP BY t.id ORDER BY t.click_count DESC,bookmark_count DESC LIMIT 10`,
	}
	for key, query := range queries {
		rows, err := all(r, s.db, query, userID(r))
		if err != nil {
			return err
		}
		payload[key] = rows
	}
	urls, err := all(r, s.db, "SELECT url FROM bookmarks WHERE user_id=? AND deleted_at IS NULL", userID(r))
	if err != nil {
		return err
	}
	payload["top_domains"] = topDomains(urls)
	filter, args, err := dateFilter(r, "created_at")
	if err != nil {
		return err
	}
	bookmarks, err := all(r, s.db, "SELECT strftime('"+format+"',created_at) AS date,COUNT(*) AS count FROM bookmarks WHERE user_id=? AND deleted_at IS NULL"+filter+" GROUP BY date ORDER BY date", append([]any{userID(r)}, args...)...)
	if err != nil {
		return err
	}
	filter, args, err = dateFilter(r, "e.clicked_at")
	if err != nil {
		return err
	}
	bound := append([]any{userID(r)}, args...)
	clicks, err := all(r, s.db, "SELECT strftime('"+format+"',e.clicked_at) AS date,COUNT(*) AS count FROM bookmark_click_events e JOIN bookmarks b ON b.id=e.bookmark_id AND b.user_id=e.user_id WHERE e.user_id=? AND b.deleted_at IS NULL"+filter+" GROUP BY date ORDER BY date", bound...)
	if err != nil {
		return err
	}
	perBookmark, err := all(r, s.db, "SELECT b.id,b.title,b.url,COUNT(e.id) AS click_count FROM bookmark_click_events e JOIN bookmarks b ON b.id=e.bookmark_id AND b.user_id=e.user_id WHERE e.user_id=? AND b.deleted_at IS NULL"+filter+" GROUP BY b.id ORDER BY click_count DESC,b.id LIMIT 100", bound...)
	if err != nil {
		return err
	}
	payload["bookmark_clicks"] = perBookmark
	payload["trends"] = object{"bookmarks": bookmarks, "clicks": clicks}
	return success(w, payload)
}
func (s *Server) groupStatistics(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.statistics"); err != nil {
		return err
	}
	if err := permit(r, "tab_groups.read"); err != nil {
		return err
	}
	days := 30
	if raw := r.URL.Query().Get("days"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 3650 {
			return problem(400, "days 必须在 1 到 3650 之间")
		}
		days = n
	}
	start := time.Now().UTC().AddDate(0, 0, -days).Format("2006-01-02")
	summary := object{}
	queries := map[string]string{
		"total_groups":         "SELECT COUNT(*) AS value FROM tab_groups WHERE user_id=? AND is_deleted=0",
		"total_deleted_groups": "SELECT COUNT(*) AS value FROM tab_groups WHERE user_id=? AND is_deleted=1",
		"total_items":          "SELECT COUNT(*) AS value FROM tab_group_items WHERE group_id IN (SELECT id FROM tab_groups WHERE user_id=? AND is_deleted=0)",
		"total_shares":         "SELECT COUNT(*) AS value FROM shares WHERE user_id=?",
	}
	for key, q := range queries {
		row, err := one(r, s.db, q, userID(r))
		if err != nil {
			return err
		}
		summary[key] = row["value"]
	}
	groups, err := all(r, s.db, "SELECT date(created_at) AS date,COUNT(*) AS count FROM tab_groups WHERE user_id=? AND date(created_at)>=? GROUP BY date ORDER BY date", userID(r), start)
	if err != nil {
		return err
	}
	items, err := all(r, s.db, "SELECT date(created_at) AS date,COUNT(*) AS count FROM tab_group_items WHERE group_id IN (SELECT id FROM tab_groups WHERE user_id=?) AND date(created_at)>=? GROUP BY date ORDER BY date", userID(r), start)
	if err != nil {
		return err
	}
	urls, err := all(r, s.db, "SELECT url FROM tab_group_items WHERE group_id IN (SELECT id FROM tab_groups WHERE user_id=? AND is_deleted=0)", userID(r))
	if err != nil {
		return err
	}
	distribution, err := all(r, s.db, `SELECT CASE WHEN n=0 THEN '0' WHEN n<=5 THEN '1-5' WHEN n<=10 THEN '6-10' WHEN n<=20 THEN '11-20' WHEN n<=50 THEN '21-50' ELSE '50+' END AS range,COUNT(*) AS count FROM (SELECT g.id,COUNT(i.id) AS n FROM tab_groups g LEFT JOIN tab_group_items i ON i.group_id=g.id WHERE g.user_id=? AND g.is_deleted=0 AND g.is_folder=0 GROUP BY g.id) GROUP BY range`, userID(r))
	if err != nil {
		return err
	}
	return success(w, object{"summary": summary, "trends": object{"groups": groups, "items": items}, "top_domains": topDomains(urls), "group_size_distribution": distribution})
}
