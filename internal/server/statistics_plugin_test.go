package server

import "testing"

func TestStatisticsPluginLifecycle(t *testing.T) {
	a := setupAnalytics(t, "stats_plugin")
	other, _ := a.account("stats_other")
	id := a.bookmark("statistics-history")
	paths := []string{"/api/v1/bookmarks/statistics", "/api/v1/statistics", "/api/v1/analytics", "/api/v1/analytics/agent", "/api/tab/statistics", "/api/v1/agent/bookmarks/statistics"}
	checkPaths := func(token string, status int) {
		t.Helper()
		for _, path := range paths {
			check(t, a.request("GET", path, token, nil), status)
		}
	}
	toggle := func(enabled bool) {
		t.Helper()
		data(t, a.request("PUT", "/api/v1/plugins/markvault.statistics", a.token, object{"enabled": enabled, "config": object{}, "grants": []string{}}), 200)
	}
	state := data(t, a.request("GET", "/api/v1/plugins/markvault.statistics", a.token, nil), 200)
	if state["origin"] != "builtin" || state["status"] != "running" {
		t.Fatal("图表应作为默认启用的内置插件")
	}
	checkPaths(a.token, 200)
	toggle(false)
	checkPaths(a.token, 409)
	checkPaths(other, 200)
	// 停用图表仍可使用书签、标签页及记录访问，重新启用保留统计。
	check(t, a.request("GET", "/api/v1/bookmarks", a.token, nil), 200)
	check(t, a.request("GET", "/api/v1/tab-groups", a.token, nil), 200)
	check(t, a.request("POST", "/api/v1/bookmarks/"+id+"/click", a.token, nil), 200)
	toggle(true)
	checkPaths(a.token, 200)
	summary := data(t, a.request("GET", "/api/v1/bookmarks/statistics", a.token, nil), 200)["summary"].(map[string]any)
	if number(summary["total_bookmarks"]) != 1 || number(summary["total_clicks"]) != 1 {
		t.Fatal("重新启用后统计数据丢失", summary)
	}
	if _, err := a.db.Exec("UPDATE users SET role='admin' WHERE id=?", a.uid); err != nil {
		t.Fatal(err)
	}
	check(t, a.request("POST", "/api/v1/plugin-admin/markvault.statistics/disable", a.token, nil), 200)
	checkPaths(a.token, 409)
	checkPaths(other, 409)
	check(t, a.request("POST", "/api/v1/plugin-admin/markvault.statistics/allow", a.token, nil), 200)
	checkPaths(other, 200)
}
