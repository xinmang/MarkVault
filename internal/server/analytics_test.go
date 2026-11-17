package server

import (
	"net/url"
	"strings"
	"testing"

	"markvault/migrations"
)

type analyticsFixture struct {
	*fixture
	token, uid string
}

func setupAnalytics(t *testing.T, name string) *analyticsFixture {
	t.Helper()
	f := setup(t)
	token, login := f.account(name)
	return &analyticsFixture{f, token, str(login["user"].(map[string]any)["id"])}
}

func (a *analyticsFixture) bookmark(title string, tags ...string) string {
	a.t.Helper()
	body := object{"title": title, "url": "https://www." + url.PathEscape(title) + ".example/page", "tag_ids": append([]string{}, tags...)}
	return str(data(a.t, a.request("POST", "/api/v1/bookmarks", a.token, body), 201)["bookmark"].(map[string]any)["id"])
}

func (a *analyticsFixture) tag(name string) string {
	a.t.Helper()
	return str(data(a.t, a.request("POST", "/api/v1/tags", a.token, object{"name": name}), 201)["tag"].(map[string]any)["id"])
}

func (a *analyticsFixture) clicks(table, column, id string, stamps ...string) {
	a.t.Helper()
	for _, stamp := range stamps {
		if _, err := a.db.Exec("INSERT INTO "+table+"("+column+",user_id,clicked_at) VALUES(?,?,?)", id, a.uid, stamp); err != nil {
			a.t.Fatal(err)
		}
	}
}

func (a *analyticsFixture) analytics(query string) object {
	a.t.Helper()
	return data(a.t, a.request("GET", "/api/v1/analytics?"+query, a.token, nil), 200)
}

func summaryNumber(t *testing.T, result object, key string) int64 {
	t.Helper()
	return number(result["summary"].(map[string]any)[key])
}

func trendCounts(result object, key string) map[string]int64 {
	counts := map[string]int64{}
	for _, value := range result["trend"].([]any) {
		point := value.(map[string]any)
		counts[str(point["bucket"])] = number(point[key])
	}
	return counts
}

func TestClickAnalyticsUsesLocalDays(t *testing.T) {
	a := setupAnalytics(t, "analytics_tz")
	first := a.bookmark("first")
	second := a.bookmark("second")
	// 上海 2026-03-10 的范围是 UTC 03-09 16:00 至 03-10 16:00。
	a.clicks("bookmark_click_events", "bookmark_id", first, "2026-03-09T16:30:00.000Z", "2026-03-10T03:00:00.000Z")
	a.clicks("bookmark_click_events", "bookmark_id", second, "2026-03-10T15:59:00.000Z", "2026-03-10T16:00:00.000Z")

	local := a.analytics("start_date=2026-03-10&end_date=2026-03-10&tz=Asia/Shanghai")
	if got := summaryNumber(t, local, "bookmark_clicks"); got != 3 {
		t.Fatalf("上海时区当天点击=%d，预期 3", got)
	}
	top := local["top_bookmarks"].([]any)[0].(map[string]any)
	if str(top["id"]) != first || number(top["clicks"]) != 2 {
		t.Fatalf("当天点击最多的书签应为 first×2: %v", top)
	}
	// 2026-03-10 是周二：本地 0 点、11 点、23 点各一次。
	tuesday := local["heatmap"].([]any)[2].([]any)
	for hour, expected := range map[int]int64{0: 1, 11: 1, 23: 1, 16: 0} {
		if got := number(tuesday[hour]); got != expected {
			t.Fatalf("周二 %d 点=%d，预期 %d", hour, got, expected)
		}
	}

	utc := a.analytics("start_date=2026-03-10&end_date=2026-03-10&tz=UTC")
	top = utc["top_bookmarks"].([]any)[0].(map[string]any)
	if summaryNumber(t, utc, "bookmark_clicks") != 3 || str(top["id"]) != second {
		t.Fatalf("UTC 当天应统计 3 次且 second 最多: %v", utc["top_bookmarks"])
	}
}

func TestClickAnalyticsHandlesDaylightSaving(t *testing.T) {
	a := setupAnalytics(t, "analytics_dst")
	bid := a.bookmark("dst")
	// 纽约 2026-03-08 02:00 进入夏令时，UTC 偏移由 -5 变为 -4。
	a.clicks("bookmark_click_events", "bookmark_id", bid,
		"2026-03-08T04:30:00.000Z", // 03-07 23:30 EST
		"2026-03-08T05:30:00.000Z", // 03-08 00:30 EST
		"2026-03-09T03:30:00.000Z", // 03-08 23:30 EDT
		"2026-03-09T04:30:00.000Z", // 03-09 00:30 EDT
	)
	result := a.analytics("start_date=2026-03-07&end_date=2026-03-09&tz=America/New_York")
	counts := trendCounts(result, "bookmark_clicks")
	for day, expected := range map[string]int64{"2026-03-07": 1, "2026-03-08": 2, "2026-03-09": 1} {
		if counts[day] != expected {
			t.Fatalf("%s 点击=%d，预期 %d；趋势=%v", day, counts[day], expected, counts)
		}
	}
	if peak := result["summary"].(map[string]any)["peak_day"].(map[string]any); str(peak["date"]) != "2026-03-08" {
		t.Fatalf("峰值日应为 2026-03-08: %v", peak)
	}
}

func TestClickAnalyticsTagsFiltersAndIsolation(t *testing.T) {
	a := setupAnalytics(t, "analytics_tags")
	tools := a.tag("工具")
	docs := a.tag("文档")
	tagged := a.bookmark("tagged", tools)
	plain := a.bookmark("plain", docs)
	removed := a.bookmark("removed", tools)
	a.clicks("bookmark_click_events", "bookmark_id", tagged, "2026-05-01T08:00:00.000Z", "2026-05-01T09:00:00.000Z")
	a.clicks("bookmark_click_events", "bookmark_id", plain, "2026-05-01T10:00:00.000Z")
	a.clicks("bookmark_click_events", "bookmark_id", removed, "2026-05-01T11:00:00.000Z")
	a.clicks("bookmark_click_events", "bookmark_id", tagged, "2026-04-30T08:00:00.000Z") // 上一周期
	check(t, a.request("DELETE", "/api/v1/bookmarks/"+removed, a.token, nil), 204)
	a.clicks("tag_click_events", "tag_id", tools, "2026-05-01T01:00:00.000Z", "2026-05-01T02:00:00.000Z")
	a.clicks("tag_click_events", "tag_id", docs, "2026-05-01T03:00:00.000Z")

	otherToken, otherLogin := a.account("analytics_intruder")
	otherBookmark := str(data(t, a.request("POST", "/api/v1/bookmarks", otherToken, object{"title": "其他", "url": "https://other.example/"}), 201)["bookmark"].(map[string]any)["id"])
	if _, err := a.db.Exec("INSERT INTO bookmark_click_events(bookmark_id,user_id,clicked_at) VALUES(?,?,?)", otherBookmark, str(otherLogin["user"].(map[string]any)["id"]), "2026-05-01T12:00:00.000Z"); err != nil {
		t.Fatal(err)
	}

	result := a.analytics("start_date=2026-05-01&end_date=2026-05-01&tz=UTC")
	if summaryNumber(t, result, "bookmark_clicks") != 3 || summaryNumber(t, result, "bookmarks_clicked") != 2 {
		t.Fatalf("应排除回收站书签和其他账号的点击: %v", result["summary"])
	}
	if summaryNumber(t, result, "tag_clicks") != 3 || summaryNumber(t, result, "tags_clicked") != 2 {
		t.Fatalf("标签点击统计错误: %v", result["summary"])
	}
	previous := result["summary"].(map[string]any)["previous"].(map[string]any)
	if str(previous["start_date"]) != "2026-04-30" || number(previous["bookmark_clicks"]) != 1 {
		t.Fatalf("上一周期对比错误: %v", previous)
	}
	topTag := result["top_tags"].([]any)[0].(map[string]any)
	if str(topTag["id"]) != tools || number(topTag["clicks"]) != 2 || number(topTag["bookmark_count"]) != 1 {
		t.Fatalf("标签排行应为工具×2且仅关联 1 个未删除书签: %v", topTag)
	}
	domains := result["top_domains"].([]any)
	if len(domains) != 2 || str(domains[0].(map[string]any)["domain"]) != "tagged.example" {
		t.Fatalf("域名排行应去掉 www 并按点击排序: %v", domains)
	}
	firstTags := result["top_bookmarks"].([]any)[0].(map[string]any)["tags"].([]any)
	if len(firstTags) != 1 || str(firstTags[0].(map[string]any)["name"]) != "工具" {
		t.Fatalf("排行书签应附带标签: %v", firstTags)
	}

	filtered := a.analytics("start_date=2026-05-01&end_date=2026-05-01&tz=UTC&tag_id=" + tools)
	if summaryNumber(t, filtered, "bookmark_clicks") != 2 || summaryNumber(t, filtered, "tag_clicks") != 2 {
		t.Fatalf("标签筛选只保留带该标签的书签与该标签点击: %v", filtered["summary"])
	}
	if name := str(filtered["filters"].(map[string]any)["tag"].(map[string]any)["name"]); name != "工具" {
		t.Fatalf("应回显筛选标签: %v", filtered["filters"])
	}
	single := a.analytics("start_date=2026-05-01&end_date=2026-05-01&tz=UTC&bookmark_id=" + plain)
	if summaryNumber(t, single, "bookmark_clicks") != 1 || summaryNumber(t, single, "tag_clicks") != 0 || len(single["top_tags"].([]any)) != 0 {
		t.Fatalf("书签筛选不返回标签数据: %v", single["summary"])
	}
	check(t, a.request("GET", "/api/v1/analytics?bookmark_id="+otherBookmark, a.token, nil), 404)
	check(t, a.request("GET", "/api/v1/analytics?bookmark_id="+removed, a.token, nil), 404)
	check(t, a.request("GET", "/api/v1/analytics?tag_id=missing", a.token, nil), 404)
}

func TestClickAnalyticsBucketsAndAllTime(t *testing.T) {
	a := setupAnalytics(t, "analytics_buckets")
	bid := a.bookmark("buckets")
	a.clicks("bookmark_click_events", "bookmark_id", bid, "2026-09-20T10:00:00.000Z", "2026-10-02T10:00:00.000Z", "2026-10-31T10:00:00.000Z")

	weeks := a.analytics("start_date=2026-10-01&end_date=2026-10-31&tz=UTC&granularity=week")["trend"].([]any)
	if len(weeks) != 5 {
		t.Fatalf("10 月应覆盖 5 个自然周: %v", weeks)
	}
	firstWeek, lastWeek := weeks[0].(map[string]any), weeks[4].(map[string]any)
	if str(firstWeek["bucket"]) != "2026-09-28" || str(firstWeek["start_date"]) != "2026-10-01" || number(firstWeek["bookmark_clicks"]) != 1 {
		t.Fatalf("首周应以周一为键并裁剪到区间: %v", firstWeek)
	}
	if str(lastWeek["end_date"]) != "2026-10-31" || number(lastWeek["bookmark_clicks"]) != 1 {
		t.Fatalf("末周应裁剪到区间结束: %v", lastWeek)
	}
	months := trendCounts(a.analytics("start_date=2026-09-15&end_date=2026-10-10&tz=UTC&granularity=month"), "bookmark_clicks")
	if len(months) != 2 || months["2026-09"] != 1 || months["2026-10"] != 1 {
		t.Fatalf("月度分桶错误: %v", months)
	}

	all := a.analytics("end_date=2026-10-31&tz=Asia/Shanghai")
	span := all["range"].(map[string]any)
	if span["all_time"] != true || str(span["start_date"]) != "2026-09-20" || str(all["first_event_date"]) != "2026-09-20" {
		t.Fatalf("全部时间应从最早点击开始: %v %v", span, all["first_event_date"])
	}
	if summaryNumber(t, all, "bookmark_clicks") != 3 || number(span["days"]) != 42 {
		t.Fatalf("全部时间统计错误: %v", all["summary"])
	}
}

func TestClickAnalyticsValidationAndPermissions(t *testing.T) {
	a := setupAnalytics(t, "analytics_validation")
	for _, query := range []string{
		"tz=Mars/Base", "tz=Local", "tz=../../etc/passwd", "granularity=hour", "limit=0", "limit=51",
		"start_date=2026-02-30", "start_date=2026-10-02&end_date=2026-10-01", "start_date=2000-01-01&end_date=2026-01-01",
	} {
		check(t, a.request("GET", "/api/v1/analytics?"+query, a.token, nil), 400)
	}
	tid := a.tag("私密标签")
	bid := a.bookmark("keyed", tid)
	a.clicks("bookmark_click_events", "bookmark_id", bid, "2026-06-01T08:00:00.000Z")
	a.clicks("tag_click_events", "tag_id", tid, "2026-06-01T08:00:00.000Z")
	key := data(t, a.request("POST", "/api/v1/settings/api-keys", a.token, object{"name": "读书签", "permissions": []string{"bookmarks.read"}}), 201)["key"].(string)
	result := data(t, a.request("GET", "/api/v1/analytics?start_date=2026-06-01&end_date=2026-06-01", key, nil), 200)
	if result["tags_available"] != false || summaryNumber(t, result, "tag_clicks") != 0 || len(result["top_tags"].([]any)) != 0 {
		t.Fatalf("缺少 tags.read 时不应返回标签数据: %v", result)
	}
	if tags := result["top_bookmarks"].([]any)[0].(map[string]any)["tags"].([]any); len(tags) != 0 {
		t.Fatalf("缺少 tags.read 时不应暴露书签标签: %v", tags)
	}
	check(t, a.request("GET", "/api/v1/analytics?tag_id="+tid, key, nil), 403)
	tagsOnly := data(t, a.request("POST", "/api/v1/settings/api-keys", a.token, object{"name": "读标签", "permissions": []string{"tags.read"}}), 201)["key"].(string)
	check(t, a.request("GET", "/api/v1/analytics", tagsOnly, nil), 403)
}

func TestTagClickRecordsEventsAndClickRateLimit(t *testing.T) {
	a := setupAnalytics(t, "analytics_clicks")
	tid := a.tag("计数")
	bid := a.bookmark("counted")
	check(t, a.request("PATCH", "/api/v1/tags/"+tid+"/click", a.token, object{}), 200)
	check(t, a.request("POST", "/api/v1/bookmarks/"+bid+"/click", a.token, nil), 200)
	var events, total int
	if err := a.db.QueryRow("SELECT COUNT(*),(SELECT click_count FROM tags WHERE id=?) FROM tag_click_events WHERE tag_id=?", tid, tid).Scan(&events, &total); err != nil {
		t.Fatal(err)
	}
	if events != 1 || total != 1 {
		t.Fatalf("标签点击应同时更新累计次数与明细: events=%d total=%d", events, total)
	}
	today := a.analytics("tz=UTC&start_date=" + strings.SplitN(now(), "T", 2)[0])
	if summaryNumber(t, today, "tag_clicks") != 1 || summaryNumber(t, today, "bookmark_clicks") != 1 {
		t.Fatalf("今天的点击应出现在统计中: %v", today["summary"])
	}
	// 限流窗口按整分钟对齐；跨过分钟边界时新窗口重新计数，因此最多尝试两个窗口的额度。
	limited := false
	for i := 0; i < 2*clickRateLimit+2; i++ {
		if a.request("POST", "/api/v1/bookmarks/"+bid+"/click", a.token, nil).Code == 429 {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("超过每分钟点击上限后应返回 429")
	}
}

func TestClickAnalyticsMigrationNormalizesLegacyStamps(t *testing.T) {
	a := setupAnalytics(t, "analytics_legacy")
	bid := a.bookmark("legacy")
	a.clicks("bookmark_click_events", "bookmark_id", bid, "2026-07-01 23:30:00", "2026-07-02T01:02:03.456Z", "2026-07-02T09:00:00+08:00")
	source, err := migrations.Files.ReadFile("0120_click_analytics.sql")
	if err != nil {
		t.Fatal(err)
	}
	update := string(source[strings.Index(string(source), "UPDATE bookmark_click_events"):])
	if _, err := a.db.Exec(update); err != nil {
		t.Fatal(err)
	}
	rows, err := a.db.Query("SELECT clicked_at FROM bookmark_click_events ORDER BY clicked_at")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := []string{}
	for rows.Next() {
		var stamp string
		if err := rows.Scan(&stamp); err != nil {
			t.Fatal(err)
		}
		got = append(got, stamp)
	}
	want := []string{"2026-07-01T23:30:00.000Z", "2026-07-02T01:00:00.000Z", "2026-07-02T01:02:03.456Z"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("历史时间戳规范化结果=%v，预期=%v", got, want)
	}
}
