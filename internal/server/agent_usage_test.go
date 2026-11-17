package server

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"markvault/internal/auth"
)

func (a *analyticsFixture) usage(query string) object {
	a.t.Helper()
	return data(a.t, a.request("GET", "/api/v1/analytics/agent?"+query, a.token, nil), 200)
}

func (a *analyticsFixture) usageEvent(source, kind, operation, stamp string, success bool, duration int) {
	a.t.Helper()
	if _, err := a.db.Exec(`INSERT INTO agent_usage_events(user_id,source,kind,operation,success,duration_ms,created_at) VALUES(?,?,?,?,?,?,?)`, a.uid, source, kind, operation, success, duration, stamp); err != nil {
		a.t.Fatal(err)
	}
}

func TestAgentUsageTracksRequestsAndMCPResults(t *testing.T) {
	a := setupAnalytics(t, "agent_usage")
	key := str(data(t, a.request("POST", "/api/v1/settings/api-keys", a.token, object{"name": "统计测试", "permissions": []string{"bookmarks.read", "bookmarks.create"}}), 201)["key"])
	check(t, a.request("GET", "/api/v1/agent/bookmarks?q=private-query", key, nil), 200)
	check(t, a.request("GET", "/api/v1/agent/bookmarks/private-resource-id", key, nil), 404)
	check(t, a.request("GET", "/api/v1/bookmarks", key, nil), 200)
	check(t, a.request("POST", "/api/v1/agent/chat", a.token, object{"messages": []object{{"role": "user", "content": "private-conversation"}}}), 400)
	for _, method := range []string{"initialize", "ping", "tools/list"} {
		check(t, a.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "id": 1, "method": method}), 200)
	}
	check(t, a.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "method": "notifications/initialized"}), 202)
	batch := []object{
		{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": object{"name": "markvault_list_bookmarks"}},
		{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": object{"name": "markvault_create_bookmark", "arguments": object{"title": "private-title", "url": "https://private.example"}}},
		{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": object{"name": "private-unknown-tool"}},
		{"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": object{"name": "markvault_list_bookmarks", "arguments": []string{}}},
	}
	// 工具错误仍通过 HTTP 200 返回，统计必须依据工具执行结果。
	if response := a.request("POST", "/api/mcp", key, batch); response.Code != 200 {
		t.Fatalf("MCP 批次失败：%s", response.Body.String())
	}
	result := a.usage("")
	for field, want := range map[string]int64{"calls": 7, "failed_calls": 5, "successful_calls": 2, "tool_calls": 4, "active_days": 1} {
		if got := summaryNumber(t, result, field); got != want {
			t.Errorf("%s=%d，预期 %d", field, got, want)
		}
	}
	if got := summaryNumber(t, a.usage("source=mcp"), "failed_calls"); got != 3 {
		t.Fatalf("MCP 错误计数=%d，预期 3", got)
	}
	rows, err := a.db.Query("SELECT operation FROM agent_usage_events")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var operation string
		if err := rows.Scan(&operation); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(operation, "private") || strings.Contains(operation, key) {
			t.Fatalf("统计记录包含私密数据：%s", operation)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestAgentAnalyticsLocalDaysAndNoDoubleCounting(t *testing.T) {
	a := setupAnalytics(t, "usage_days")
	a.usageEvent("chat", "request", "POST /api/v1/agent/chat", "2026-03-09T16:00:00.000Z", true, 100)
	a.usageEvent("chat", "tool", "markvault_list_bookmarks", "2026-03-09T16:01:00.000Z", true, 10)
	a.usageEvent("agent_api", "request", "GET /api/v1/agent/bookmarks", "2026-03-10T05:00:00.000Z", false, 200)
	a.usageEvent("mcp", "tool", "markvault_list_bookmarks", "2026-03-10T15:59:59.999Z", true, 300)
	a.usageEvent("mcp", "tool", "markvault_list_bookmarks", "2026-03-10T16:00:00.000Z", true, 900)
	result := a.usage("start_date=2026-03-10&end_date=2026-03-10&tz=Asia/Shanghai&limit=1")
	if summaryNumber(t, result, "calls") != 3 || summaryNumber(t, result, "tool_calls") != 2 || summaryNumber(t, result, "active_days") != 1 {
		t.Fatalf("自然日边界或内部工具去重错误：%v", result["summary"])
	}
	summary := result["summary"].(map[string]any)
	if summary["success_rate"] != 66.7 || summary["avg_duration_ms"] != float64(200) {
		t.Fatalf("成功率或加权平均耗时错误：%v", summary)
	}
	if len(result["top_operations"].([]any)) != 1 {
		t.Fatal("排行未按 limit 截断")
	}
	point := result["trend"].([]any)[0].(map[string]any)
	for _, source := range []string{"chat", "agent_api", "mcp"} {
		if number(point[source]) != 1 {
			t.Fatalf("来源趋势错误：%v", point)
		}
	}
	mcp := a.usage("source=mcp&end_date=2026-03-12&tz=Asia/Shanghai")
	if mcp["first_event_date"] != "2026-03-10" || summaryNumber(t, mcp, "calls") != 2 || len(mcp["trend"].([]any)) != 3 {
		t.Fatalf("全部时间、来源筛选或补零错误：%v", mcp)
	}
	week := a.usage("start_date=2026-03-10&end_date=2026-03-12&tz=Asia/Shanghai&granularity=week")
	if len(week["trend"].([]any)) != 1 || trendCounts(week, "mcp")["2026-03-09"] != 2 {
		t.Fatalf("按周聚合错误：%v", week["trend"])
	}
	month := a.usage("start_date=2026-03-10&end_date=2026-04-01&tz=Asia/Shanghai&granularity=month")
	if len(month["trend"].([]any)) != 2 || trendCounts(month, "chat")["2026-03"] != 1 || trendCounts(month, "mcp")["2026-04"] != 0 {
		t.Fatalf("按月聚合错误：%v", month["trend"])
	}
}

func TestAgentAnalyticsDST(t *testing.T) {
	a := setupAnalytics(t, "usage_dst")
	for _, stamp := range []string{"2026-03-08T04:59:59.999Z", "2026-03-08T05:00:00.000Z", "2026-03-08T07:00:00.000Z", "2026-03-09T03:59:59.999Z", "2026-03-09T04:00:00.000Z"} {
		a.usageEvent("mcp", "tool", "markvault_list_bookmarks", stamp, true, 1)
	}
	result := a.usage("start_date=2026-03-08&end_date=2026-03-08&tz=America/New_York")
	if summaryNumber(t, result, "calls") != 3 || trendCounts(result, "mcp")["2026-03-08"] != 3 {
		t.Fatalf("夏令时切换日统计错误：%v", result)
	}
}

func TestAgentAnalyticsIsolationValidationAndEmpty(t *testing.T) {
	a := setupAnalytics(t, "usage_owner")
	other, login := a.account("usage_other")
	uid := str(login["user"].(map[string]any)["id"])
	if _, err := a.db.Exec(`INSERT INTO agent_usage_events(user_id,source,kind,operation,success,duration_ms,created_at) VALUES(?,'mcp','tool','private-tool',1,1,?)`, uid, utcStamp(time.Now())); err != nil {
		t.Fatal(err)
	}
	result := a.usage("start_date=2026-03-01&end_date=2026-03-03")
	if result["first_event_date"] != nil || summaryNumber(t, result, "calls") != 0 || result["summary"].(map[string]any)["success_rate"] != nil || len(result["top_operations"].([]any)) != 0 || len(result["trend"].([]any)) != 3 {
		t.Fatalf("空数据或用户隔离错误：%v", result)
	}
	if summaryNumber(t, a.usage(""), "calls") != 0 {
		t.Fatal("读取到了其他用户的数据")
	}
	otherData := data(t, a.request("GET", "/api/v1/analytics/agent", other, nil), 200)
	if summaryNumber(t, otherData, "calls") != 1 {
		t.Fatal("其他用户无法读取自己的统计")
	}
	key := str(data(t, a.request("POST", "/api/v1/settings/api-keys", a.token, object{"name": "只读", "permissions": []string{"bookmarks.read"}}), 201)["key"])
	check(t, a.request("GET", "/api/v1/analytics/agent", key, nil), 403)
	check(t, a.request("GET", "/api/v1/analytics/agent", "", nil), 401)
	for _, query := range []string{"source=unknown", "start_date=2026-03-02&end_date=2026-03-01", "tz=Invalid", "granularity=hour", "limit=51", "bookmark_id=private", "tag_id=private", "start_date=2000-01-01&end_date=2026-01-01"} {
		check(t, a.request("GET", "/api/v1/analytics/agent?"+query, a.token, nil), 400)
	}
	// 客户端取消不会抹去已完成调用；日志写失败也不能改变原操作结果。
	request := httptest.NewRequest("GET", "/api/v1/agent/bookmarks", nil)
	ctx, cancel := context.WithCancel(context.WithValue(request.Context(), authContextKey{}, &principal{UserID: a.uid}))
	cancel()
	server := &Server{db: a.db}
	server.recordAgentUsage(request.WithContext(ctx), "agent_api", "request", "GET /api/v1/agent/bookmarks", time.Now(), true)
	if summaryNumber(t, a.usage(""), "calls") != 1 {
		t.Fatal("取消请求后未保存已完成调用")
	}
	if _, err := a.db.Exec(`CREATE TRIGGER fail_agent_usage BEFORE INSERT ON agent_usage_events BEGIN SELECT RAISE(ABORT,'统计不可写'); END`); err != nil {
		t.Fatal(err)
	}
	check(t, a.request("POST", "/api/v1/agent/bookmarks", a.token, object{"title": "已保存", "url": "https://example.com/" + auth.ID()}), 201)
}
