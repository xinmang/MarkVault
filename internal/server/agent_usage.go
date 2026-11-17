package server

import (
	"context"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// 站内工具调用单列，避免与外层聊天或确认请求重复计入总调用量。
const agentUsageCalls = "(kind='request' OR source='mcp')"

func (s *Server) recordAgentUsage(r *http.Request, source, kind, operation string, started time.Time, succeeded bool) {
	duration := max(int64(0), time.Since(started).Milliseconds())
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
	defer cancel()
	pluginID, toolSource, connectionID := "", "", ""
	if kind == "tool" {
		pluginID, toolSource = "markvault.tools", "builtin"
		if strings.HasPrefix(operation, "plugin_") {
			pluginID, toolSource = "", "plugin"
			if definitions, e := s.availableTools(r); e == nil {
				if d, ok := findDefinition(definitions, operation); ok {
					pluginID = d.PluginID
				}
			}
			if pluginID == "markvault.mcp-client" {
				toolSource = "external-mcp"
				if connections, e := s.mcpConnections(r); e == nil {
					for _, c := range connections {
						for _, tool := range c.Tools {
							if pluginToolName("mcp:"+c.ID, str(tool["name"])) == operation {
								connectionID = c.ID
							}
						}
					}
				}
			}
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_usage_events(user_id,source,kind,operation,success,duration_ms,created_at,plugin_id,tool_source,connection_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, userID(r), source, kind, operation, succeeded, duration, utcStamp(started), pluginID, toolSource, connectionID)
	if err != nil {
		// 统计故障不改变原操作结果，避免客户端重试已成功的写操作。
		s.log.Warn("记录 Agent 使用统计失败", "error", err)
	}
}

func (s *Server) trackAgentRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/agent/") {
			next.ServeHTTP(w, r)
			return
		}
		pluginID := "markvault.agent-api"
		if strings.HasPrefix(r.URL.Path, "/api/v1/agent/chat") {
			pluginID = "markvault.agent"
		}
		if err := s.requirePlugin(r, pluginID); err != nil {
			s.fail(w, r, err)
			return
		}
		started := time.Now()
		response := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		s.recover(next).ServeHTTP(response, r)
		pattern := chi.RouteContext(r.Context()).RoutePattern()
		if pattern == "" {
			return
		}
		source := "agent_api"
		if pattern == "/api/v1/agent/chat" || strings.HasPrefix(pattern, "/api/v1/agent/chat/") {
			source = "chat"
		}
		status := response.Status()
		// 使用路由模板，避免资源 ID、查询词和确认凭证进入统计记录。
		s.recordAgentUsage(r, source, "request", r.Method+" "+pattern, started, status < 400)
	})
}

func (s *Server) toolUsageOperation(name string) string {
	if _, ok := s.findTool(name); ok {
		return name
	}
	return "unknown_tool"
}

func agentUsageMetrics(calls, successes, duration int64) object {
	result := object{"calls": calls, "successful_calls": successes, "failed_calls": calls - successes, "success_rate": nil, "avg_duration_ms": nil}
	if calls > 0 {
		result["success_rate"] = math.Round(float64(successes)*1000/float64(calls)) / 10
		result["avg_duration_ms"] = math.Round(float64(duration)*10/float64(calls)) / 10
	}
	return result
}

func (s *Server) agentAnalytics(w http.ResponseWriter, r *http.Request) error {
	// 账号级使用统计只对本人登录会话开放，不随书签读取权限暴露给 API Key。
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requirePlugin(r, "markvault.statistics"); err != nil {
		return err
	}
	req, err := parseAnalyticsRequest(r, time.Now())
	if err != nil {
		return err
	}
	if req.tagID != "" || req.bookmarkID != "" {
		return problem(400, "Agent 使用统计不支持书签或标签筛选")
	}
	source := r.URL.Query().Get("source")
	switch source {
	case "", "all", "chat", "agent_api", "mcp":
	default:
		return problem(400, "调用来源无效")
	}
	if err := s.rate(r, w, "agent-analytics:"+userID(r), 120, 60); err != nil {
		return err
	}
	where := "user_id=?"
	args := []any{userID(r)}
	if source != "" && source != "all" {
		where += " AND source=?"
		args = append(args, source)
	}
	var first *string
	if err := s.db.QueryRowContext(r.Context(), "SELECT MIN(created_at) FROM agent_usage_events WHERE "+where+" AND "+agentUsageCalls, args...).Scan(&first); err != nil {
		return err
	}
	var firstDate any
	if first != nil {
		stamp, err := time.Parse(time.RFC3339Nano, *first)
		if err != nil {
			return err
		}
		date := civilDate(stamp.In(req.loc))
		firstDate = date.Format(analyticsDateLayout)
		if req.allTime {
			req.start = date
			if req.start.After(req.end) {
				req.start = req.end
			}
			if earliest := req.end.AddDate(0, 0, -(analyticsMaxDays - 1)); req.start.Before(earliest) {
				req.start = earliest
			}
		}
	}
	from := localMidnight(req.start, req.loc)
	to := localMidnight(req.end.AddDate(0, 0, 1), req.loc)
	where += " AND created_at>=? AND created_at<?"
	args = append(args, utcStamp(from), utcStamp(to))
	rows, err := all(r, s.db, "SELECT source,COUNT(*) AS calls,SUM(success) AS successes,SUM(duration_ms) AS duration FROM agent_usage_events WHERE "+where+" AND "+agentUsageCalls+" GROUP BY source", args...)
	if err != nil {
		return err
	}
	sources := []object{}
	var calls, successes, duration int64
	for _, name := range []string{"chat", "agent_api", "mcp"} {
		metrics := agentUsageMetrics(0, 0, 0)
		for _, row := range rows {
			if str(row["source"]) == name {
				n, ok, ms := number(row["calls"]), number(row["successes"]), number(row["duration"])
				metrics = agentUsageMetrics(n, ok, ms)
				calls, successes, duration = calls+n, successes+ok, duration+ms
			}
		}
		metrics["source"] = name
		sources = append(sources, metrics)
	}
	summary := agentUsageMetrics(calls, successes, duration)
	var toolCalls int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM agent_usage_events WHERE "+where+" AND kind='tool'", args...).Scan(&toolCalls); err != nil {
		return err
	}
	summary["tool_calls"] = toolCalls

	cte, cteArgs := segmentCTE(zoneSegments(req.loc, from, to))
	daily, err := all(r, s.db, cte+"SELECT date(created_at,seg.m) AS day,source,COUNT(*) AS calls FROM agent_usage_events JOIN seg ON created_at>=seg.s AND created_at<seg.e WHERE "+where+" AND "+agentUsageCalls+" GROUP BY day,source", append(cteArgs, args...)...)
	if err != nil {
		return err
	}
	days := map[string]map[string]int64{}
	for _, row := range daily {
		day := str(row["day"])
		if days[day] == nil {
			days[day] = map[string]int64{}
		}
		days[day][str(row["source"])] = number(row["calls"])
	}
	summary["active_days"] = len(days)
	trend := []object{}
	for day := req.start; !day.After(req.end); day = day.AddDate(0, 0, 1) {
		key := analyticsBucketKey(day, req.granularity)
		date := day.Format(analyticsDateLayout)
		if len(trend) == 0 || trend[len(trend)-1]["bucket"] != key {
			trend = append(trend, object{"bucket": key, "start_date": date, "end_date": date, "chat": int64(0), "agent_api": int64(0), "mcp": int64(0)})
		}
		bucket := trend[len(trend)-1]
		bucket["end_date"] = date
		for _, name := range []string{"chat", "agent_api", "mcp"} {
			bucket[name] = number(bucket[name]) + days[date][name]
		}
	}
	operations, err := all(r, s.db, "SELECT source,operation,COUNT(*) AS calls,SUM(success) AS successes,SUM(duration_ms) AS duration FROM agent_usage_events WHERE "+where+" AND (kind='tool' OR source='agent_api') GROUP BY source,operation ORDER BY calls DESC,source,operation LIMIT ?", append(args, req.limit)...)
	if err != nil {
		return err
	}
	for i, operation := range operations {
		metrics := agentUsageMetrics(number(operation["calls"]), number(operation["successes"]), number(operation["duration"]))
		metrics["source"], metrics["operation"] = operation["source"], operation["operation"]
		operations[i] = metrics
	}
	return success(w, object{
		"range":            object{"start_date": req.start.Format(analyticsDateLayout), "end_date": req.end.Format(analyticsDateLayout), "tz": req.tz, "granularity": req.granularity, "days": spanDays(req.start, req.end), "all_time": req.allTime},
		"first_event_date": firstDate,
		"summary":          summary, "sources": sources, "trend": trend, "top_operations": operations,
	})
}
