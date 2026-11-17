package server

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// 内网目标只能由部署管理员通过完整 HTTPS 来源逐项放行，用户配置无法放宽策略。
func (s *Server) mcpHTTPClient(target string) *http.Client {
	client := pluginHTTPClient()
	client.Timeout = 0
	parsed, err := url.Parse(target)
	if err != nil {
		return client
	}
	origin := parsed.Scheme + "://" + parsed.Host
	allowed := false
	for _, item := range strings.Split(s.config.PluginPrivateTargets, ",") {
		if strings.TrimSpace(item) == origin {
			allowed = true
		}
	}
	if !allowed {
		return client
	}
	transport := client.Transport.(*http.Transport)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if host != parsed.Hostname() {
			return nil, problem(403, "目标不在管理员白名单内")
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, problem(502, "目标解析失败")
		}
		dialer := net.Dialer{Timeout: 10 * time.Second}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return client
}
