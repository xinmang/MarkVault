package server

import (
	"net/http/httptest"
	"testing"
	"time"

	"markvault/internal/auth"
)

func setupPublicClicks(t *testing.T) (*analyticsFixture, string, string) {
	t.Helper()
	a := setupAnalytics(t, "public_click_owner")
	check(t, a.request("PUT", "/api/v1/settings/share", a.token, object{"enabled": true, "slug": "click-owner"}), 200)
	tag := a.tag("公开标签")
	bookmark := a.bookmark("public-click", tag)
	check(t, a.request("PATCH", "/api/v1/bookmarks/"+bookmark, a.token, object{"is_public": true}), 200)
	return a, bookmark, tag
}

func TestPublicClicksCountForOwnerAnalytics(t *testing.T) {
	a, bookmark, tag := setupPublicClicks(t)
	visitor, _ := a.account("public_click_visitor")
	check(t, a.request("GET", "/api/public/click-owner", "", nil), 200)
	if summaryNumber(t, a.analytics(""), "bookmark_clicks") != 0 {
		t.Fatal("仅浏览分享页不应增加点击")
	}
	check(t, a.request("POST", "/api/public/CLICK-OWNER/bookmarks/"+bookmark+"/click", "", nil), 204)
	// 访客即使已登录或提交伪造账号，记录也只能归属于分享者。
	check(t, a.request("POST", "/api/public/click-owner/tags/"+tag+"/click", visitor, object{"user_id": "other-user"}), 204)
	check(t, a.request("POST", "/api/v1/bookmarks/"+bookmark+"/click", a.token, nil), 200)
	result := a.analytics("")
	if summaryNumber(t, result, "bookmark_clicks") != 2 || summaryNumber(t, result, "tag_clicks") != 1 || summaryNumber(t, result, "active_days") != 1 {
		t.Fatalf("公开点击未合并计入分享者统计：%v", result["summary"])
	}
	if len(result["top_bookmarks"].([]any)) != 1 || len(result["top_tags"].([]any)) != 1 {
		t.Fatal("公开点击未计入排行")
	}
	visitorStats := data(t, a.request("GET", "/api/v1/analytics", visitor, nil), 200)
	if summaryNumber(t, visitorStats, "bookmark_clicks") != 0 || summaryNumber(t, visitorStats, "tag_clicks") != 0 {
		t.Fatal("公开点击被错误记入访客账号")
	}
	public := data(t, a.request("GET", "/api/public/click-owner", "", nil), 200)
	if number(public["bookmarks"].([]any)[0].(map[string]any)["click_count"]) != 2 || number(public["tags"].([]any)[0].(map[string]any)["click_count"]) != 1 {
		t.Fatal("公开页累计点击数未更新")
	}
}

func TestPublicClicksRejectHiddenAndForeignResources(t *testing.T) {
	a, bookmark, tag := setupPublicClicks(t)
	privateTag := a.tag("私有标签")
	privateBookmark := a.bookmark("private-click", privateTag)
	unusedTag := a.tag("无关联书签")
	other, _ := a.account("other_public_owner")
	check(t, a.request("PUT", "/api/v1/settings/share", other, object{"enabled": true, "slug": "other-owner"}), 200)
	for _, path := range []string{
		"/api/public/click-owner/bookmarks/" + privateBookmark + "/click",
		"/api/public/click-owner/tags/" + privateTag + "/click",
		"/api/public/click-owner/tags/" + unusedTag + "/click",
		"/api/public/click-owner/bookmarks/missing/click",
		"/api/public/click-owner/tags/missing/click",
		"/api/public/other-owner/bookmarks/" + bookmark + "/click",
		"/api/public/other-owner/tags/" + tag + "/click",
		"/api/public/missing-owner/bookmarks/" + bookmark + "/click",
	} {
		check(t, a.request("POST", path, a.token, nil), 404)
	}
	check(t, a.request("PATCH", "/api/v1/bookmarks/"+bookmark, a.token, object{"is_public": false}), 200)
	check(t, a.request("POST", "/api/public/click-owner/bookmarks/"+bookmark+"/click", "", nil), 404)
	check(t, a.request("POST", "/api/public/click-owner/tags/"+tag+"/click", "", nil), 404)
	check(t, a.request("PATCH", "/api/v1/bookmarks/"+bookmark, a.token, object{"is_public": true}), 200)
	check(t, a.request("DELETE", "/api/v1/bookmarks/"+bookmark, a.token, nil), 204)
	check(t, a.request("POST", "/api/public/click-owner/bookmarks/"+bookmark+"/click", "", nil), 404)
	check(t, a.request("POST", "/api/public/click-owner/tags/"+tag+"/click", "", nil), 404)
	var count int
	if err := a.db.QueryRow("SELECT (SELECT COUNT(*) FROM bookmark_click_events)+(SELECT COUNT(*) FROM tag_click_events)").Scan(&count); err != nil || count != 0 {
		t.Fatalf("被拒绝的点击不应写入明细：%d %v", count, err)
	}
}

func TestPublicClicksRecheckRevokedShareAndDeletedTag(t *testing.T) {
	a, bookmark, tag := setupPublicClicks(t)
	check(t, a.request("GET", "/api/public/click-owner", "", nil), 200)
	check(t, a.request("PUT", "/api/v1/settings/share", a.token, object{"enabled": false}), 200)
	for _, suffix := range []string{"bookmarks/" + bookmark, "tags/" + tag} {
		check(t, a.request("POST", "/api/public/click-owner/"+suffix+"/click", "", nil), 404)
	}
	check(t, a.request("PUT", "/api/v1/settings/share", a.token, object{"enabled": true, "slug": "new-click-owner"}), 200)
	check(t, a.request("POST", "/api/public/click-owner/bookmarks/"+bookmark+"/click", "", nil), 404)
	check(t, a.request("POST", "/api/public/new-click-owner/bookmarks/"+bookmark+"/click", "", nil), 204)
	if _, err := a.db.Exec("UPDATE tags SET deleted_at=? WHERE id=?", now(), tag); err != nil {
		t.Fatal(err)
	}
	check(t, a.request("POST", "/api/public/new-click-owner/tags/"+tag+"/click", "", nil), 404)
}

func TestPublicClicksAreAtomic(t *testing.T) {
	for _, kind := range []string{"bookmarks", "tags"} {
		t.Run(kind, func(t *testing.T) {
			a, bookmark, tag := setupPublicClicks(t)
			target, events := bookmark, "bookmark_click_events"
			if kind == "tags" {
				target, events = tag, "tag_click_events"
			}
			if _, err := a.db.Exec("CREATE TRIGGER fail_public_event BEFORE INSERT ON " + events + " BEGIN SELECT RAISE(ABORT,'无法写入统计'); END"); err != nil {
				t.Fatal(err)
			}
			check(t, a.request("POST", "/api/public/click-owner/"+kind+"/"+target+"/click", "", nil), 500)
			var count int
			var stamp *string
			if err := a.db.QueryRow("SELECT click_count,last_clicked_at FROM "+kind+" WHERE id=?", target).Scan(&count, &stamp); err != nil || count != 0 || stamp != nil {
				t.Fatalf("明细失败后累计统计未回滚：%d %v %v", count, stamp, err)
			}
		})
	}
}

func TestPublicClicksRateLimitDoesNotConsumeOwnerQuota(t *testing.T) {
	a, bookmark, tag := setupPublicClicks(t)
	path := "/api/public/click-owner/bookmarks/" + bookmark + "/click"
	r := httptest.NewRequest("POST", path, nil)
	server := &Server{}
	key := "public-click:" + auth.HashToken(server.clientIP(r))
	window := time.Now().Unix() / 60 * 60
	if _, err := a.db.Exec("INSERT INTO rate_limits(key,window_seconds,window_start,count,updated_at) VALUES(?,60,?,?,?)", key, window, clickRateLimit-1, window); err != nil {
		t.Fatal(err)
	}
	check(t, a.request("POST", path, "", nil), 204)
	limited := a.request("POST", "/api/public/click-owner/tags/"+tag+"/click", "", nil)
	check(t, limited, 429)
	if limited.Header().Get("Retry-After") == "" {
		t.Fatal("公开点击限流缺少重试提示")
	}
	r.Header.Set("X-Forwarded-For", "203.0.113.55")
	w := httptest.NewRecorder()
	a.handler.ServeHTTP(w, r)
	check(t, w, 429)
	// 另一访客与分享者本人的登录点击仍可正常记录。
	r = httptest.NewRequest("POST", path, nil)
	r.RemoteAddr = "203.0.113.55:1234"
	w = httptest.NewRecorder()
	a.handler.ServeHTTP(w, r)
	check(t, w, 204)
	check(t, a.request("POST", "/api/v1/tags/"+tag+"/click", a.token, nil), 405)
	check(t, a.request("PATCH", "/api/v1/tags/"+tag+"/click", a.token, nil), 200)
}
