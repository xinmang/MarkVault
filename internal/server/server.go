package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"markvault/internal/config"
	"markvault/internal/database"
	"markvault/internal/plugin"
)

type object = map[string]any
type Server struct {
	handler         http.Handler
	lifecycleMu     sync.Mutex
	pluginUsers     map[string]*userPlugins
	mcpWatches      map[string]*mcpWatch
	imageClient     func(string) *http.Client
	bundle          plugin.Bundle
	plugins         *plugin.Store
	pluginRuntime   *plugin.Runtime
	db              *sql.DB
	config          config.Config
	log             *slog.Logger
	lastRateCleanup atomic.Int64
	// importBusy 保证同一时间只有一个导入事务占用 SQLite 的唯一连接。
	importBusy atomic.Bool
	// snapshotSlots 限制同时解码的快照请求数，单个请求最多占用数百 MB 内存。
	snapshotSlots chan struct{}
}
type handler func(http.ResponseWriter, *http.Request) error
type httpError struct {
	status  int
	message string
	code    string
}

func (e *httpError) Error() string { return e.message }
func problem(status int, message string) error {
	return &httpError{status, message, strings.ToUpper(strings.ReplaceAll(http.StatusText(status), " ", "_"))}
}
func New(db *sql.DB, cfg config.Config, logger *slog.Logger, bundle plugin.Bundle) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{bundle: bundle, db: db, config: cfg, log: logger, snapshotSlots: make(chan struct{}, 2)}
	s.pluginRuntime = plugin.NewRuntime(cfg.DenoPath)
	s.imageClient = s.mcpHTTPClient
	s.plugins = &plugin.Store{DB: db, Builtins: bundle.Manifests, RuntimeAvailable: s.pluginRuntime.Available()}
	s.plugins.OfficialDigests = map[string]bool{}
	s.plugins.Policy = bundle.Policy
	for _, p := range bundle.Samples {
		s.plugins.OfficialDigests[p.Digest] = true
	}
	s.drainGarbage(context.Background())
	r := chi.NewRouter()
	r.Use(middleware.RequestID, s.headers, s.recover)
	r.Get("/api/v1/health", s.handle(s.health))
	// 品牌信息是公开数据，登录页和分享页需要在未登录时读取。
	r.Get("/api/v1/site", s.handle(s.publicSiteHandler))
	r.Get("/api/v1/agent", s.handle(s.agentCapabilities))
	r.Get("/api/v1/bookmarks/{id}/snapshots/{snapshotId}/view", s.handle(s.viewSnapshot))
	r.Get("/api/snapshot-images/{hash}", s.handle(s.snapshotImage))
	r.Get("/api/bookmark-images/images/{hash}", s.handle(s.bookmarkImage))
	r.Get("/api/bookmark-screenshots/{screenshotId}", s.handle(s.screenshotImage))
	r.Get("/api/default-bookmark-image", s.handle(s.defaultImage))
	r.Get("/api/share/{token}", s.handle(s.publicGroup))
	r.Get("/api/public/{slug}", s.handle(s.publicBookmarks))
	r.Post("/api/public/{slug}/bookmarks/{id}/click", s.handle(s.publicBookmarkClick))
	r.Post("/api/public/{slug}/tags/{id}/click", s.handle(s.publicTagClick))
	r.Post("/api/v1/auth/register", s.handle(s.register))
	r.Get("/api/v1/auth/options", s.handle(s.authOptions))
	r.Post("/api/v1/auth/passkey/login/begin", s.handle(s.passkeyLoginBegin))
	r.Post("/api/v1/auth/passkey/login/finish", s.handle(s.passkeyLoginFinish))
	r.Post("/api/v1/auth/login", s.handle(s.login))
	r.Post("/api/v1/auth/refresh", s.handle(s.refresh))
	r.Group(func(r chi.Router) {
		r.Use(s.authenticate, s.trackAgentRequests)
		s.pluginRoutes(r)
		r.Get("/api/v1/analytics/agent", s.handle(s.agentAnalytics))
		r.Post("/api/v1/auth/logout", s.handle(s.logout))
		r.Post("/api/mcp", s.handle(s.mcp))
		r.Get("/api/v1/export", s.handle(s.exportData))
		r.Post("/api/v1/export", s.handle(s.exportData))
		r.Post("/api/v1/import", s.handle(s.importData))
		r.Post("/api/v1/change-password", s.handle(s.changePassword))
		r.Get("/api/v1/preferences", s.handle(s.preferences))
		r.Get("/api/v1/settings/ai", s.handle(s.aiSettingsHandler))
		r.Put("/api/v1/settings/ai", s.handle(s.aiSettingsHandler))
		r.Post("/api/v1/settings/ai/test", s.handle(s.aiTest))
		r.Post("/api/v1/agent/chat", s.handle(s.agentChat))
		r.Post("/api/v1/agent/chat/confirm", s.handle(s.confirmAgent))
		r.Post("/api/v1/agent/chat/cancel", s.handle(s.confirmAgent))
		r.Get("/api/v1/settings/share", s.handle(s.shareSettings))
		r.Put("/api/v1/settings/share", s.handle(s.shareSettings))
		// 全站品牌设置：读取对所有登录账号开放，写入由服务端校验管理员身份。
		r.Get("/api/v1/settings/site", s.handle(s.siteSettingsHandler))
		r.Get("/api/v1/settings/auth", s.handle(s.authSettings))
		r.Put("/api/v1/settings/auth", s.handle(s.authSettings))
		r.Get("/api/v1/auth/passkey/credentials", s.handle(s.passkeyList))
		r.Post("/api/v1/auth/passkey/register/begin", s.handle(s.passkeyRegisterBegin))
		r.Post("/api/v1/auth/passkey/register/finish", s.handle(s.passkeyRegisterFinish))
		r.Post("/api/v1/auth/passkey/credentials/{id}/delete", s.handle(s.passkeyDelete))
		r.Put("/api/v1/settings/site", s.handle(s.siteSettingsHandler))
		r.Get("/api/v1/settings/storage", s.handle(s.storageQuota))
		r.Patch("/api/v1/preferences", s.handle(s.updatePreferences))
		r.Get("/api/v1/settings/api-keys", s.handle(s.listKeys))
		r.Post("/api/v1/settings/api-keys", s.handle(s.createKey))
		r.Get("/api/v1/settings/api-keys/{id}", s.handle(s.getKey))
		r.Patch("/api/v1/settings/api-keys/{id}", s.handle(s.updateKey))
		r.Delete("/api/v1/settings/api-keys/{id}", s.handle(s.deleteKey))
		r.Get("/api/v1/settings/api-keys/{id}/logs", s.handle(s.keyLogs))
		for _, prefix := range []string{"/api/v1", "/api/tab", "/api/v1/agent"} {
			r.Get(prefix+"/me", s.handle(s.me))
			r.Get(prefix+"/search", s.handle(s.search))
			r.Get(prefix+"/tags/{id}", s.handle(s.getTag))
			r.Get(prefix+"/tab-groups", s.handle(s.listGroups))
			r.Post(prefix+"/tab-groups", s.handle(s.createGroup))
			r.Get(prefix+"/tab-groups/trash", s.handle(s.listGroups))
			r.Patch(prefix+"/tab-groups/batch-update", s.handle(s.batchGroups))
			r.Get(prefix+"/tab-groups/{id}", s.handle(s.getGroup))
			r.Get(prefix+"/tab-groups/{id}/share", s.handle(s.groupShare))
			r.Post(prefix+"/tab-groups/{id}/share", s.handle(s.groupShare))
			r.Delete(prefix+"/tab-groups/{id}/share", s.handle(s.groupShare))
			r.Patch(prefix+"/tab-groups/{id}", s.handle(s.updateGroup))
			r.Delete(prefix+"/tab-groups/{id}", s.handle(s.deleteGroup))
			r.Post(prefix+"/tab-groups/{id}/restore", s.handle(s.restoreGroup))
			r.Delete(prefix+"/tab-groups/{id}/permanent-delete", s.handle(s.permanentGroup))
			r.Post(prefix+"/tab-groups/{id}/items/batch", s.handle(s.addGroupItems))
			r.Patch(prefix+"/tab-groups/items/{id}", s.handle(s.updateGroupItem))
			r.Delete(prefix+"/tab-groups/items/{id}", s.handle(s.deleteGroupItem))
			r.Post(prefix+"/tab-groups/items/{id}/move", s.handle(s.moveGroupItem))
			r.Get(prefix+"/tab-groups/items/{id}/notes", s.handle(s.listNotes(tabNotes)))
			r.Post(prefix+"/tab-groups/items/{id}/notes", s.handle(s.createNote(tabNotes)))
			r.Get(prefix+"/bookmarks/{id}/notes", s.handle(s.listNotes(bookmarkNotes)))
			r.Post(prefix+"/bookmarks/{id}/notes", s.handle(s.createNote(bookmarkNotes)))
			r.Patch(prefix+"/notes/{id}", s.handle(s.updateNote))
			r.Delete(prefix+"/notes/{id}", s.handle(s.deleteNote))
			r.Get(prefix+"/bookmarks", s.handle(s.listBookmarks))
			r.Post(prefix+"/bookmarks", s.handle(s.createBookmark))
			r.Post(prefix+"/bookmarks/batch", s.handle(s.batchBookmarks))
			r.Post(prefix+"/bookmarks/reorder-pinned", s.handle(s.reorderPinned))
			r.Get(prefix+"/bookmarks/check-url", s.handle(s.checkURL))
			r.Get(prefix+"/bookmarks/statistics", s.handle(s.bookmarkStatistics))
			r.Get(prefix+"/statistics", s.handle(s.groupStatistics))
			r.Get(prefix+"/analytics", s.handle(s.clickAnalytics))
			r.Get(prefix+"/bookmarks/trash", s.handle(s.listBookmarks))
			r.Delete(prefix+"/bookmarks/trash/empty", s.handle(s.emptyTrash))
			r.Patch(prefix+"/bookmarks/bulk", s.handle(s.bulkBookmarks))
			r.Get(prefix+"/bookmarks/{id}/snapshots", s.handle(s.listSnapshots))
			r.Post(prefix+"/bookmarks/{id}/snapshots", s.handle(s.createSnapshot))
			r.Post(prefix+"/bookmarks/{id}/snapshots-v2", s.handle(s.createSnapshot))
			r.Post(prefix+"/bookmarks/{id}/snapshots/cleanup", s.handle(s.cleanupSnapshots))
			r.Get(prefix+"/bookmarks/{id}/snapshots/{snapshotId}", s.handle(s.viewSnapshot))
			r.Delete(prefix+"/bookmarks/{id}/snapshots/{snapshotId}", s.handle(s.deleteSnapshot))
			r.Post(prefix+"/bookmarks/{id}/screenshots", s.handle(s.uploadScreenshot))
			r.Delete(prefix+"/bookmarks/{id}/screenshots", s.handle(s.deleteScreenshot))
			r.Get(prefix+"/bookmarks/{id}", s.handle(s.getBookmark))
			r.Patch(prefix+"/bookmarks/{id}", s.handle(s.updateBookmark))
			r.Delete(prefix+"/bookmarks/{id}", s.handle(s.deleteBookmark))
			r.Put(prefix+"/bookmarks/{id}", s.handle(s.restoreBookmark))
			r.Patch(prefix+"/bookmarks/{id}/restore", s.handle(s.restoreBookmark))
			r.Post(prefix+"/bookmarks/{id}/restore", s.handle(s.restoreBookmark))
			r.Delete(prefix+"/bookmarks/{id}/permanent", s.handle(s.permanentBookmark))
			r.Post(prefix+"/bookmarks/{id}/click", s.handle(s.clickBookmark))
			r.Get(prefix+"/tags", s.handle(s.listTags))
			r.Post(prefix+"/tags", s.handle(s.createTag))
			r.Patch(prefix+"/tags/{id}", s.handle(s.updateTag))
			r.Delete(prefix+"/tags/{id}", s.handle(s.deleteTag))
			r.Patch(prefix+"/tags/{id}/click", s.handle(s.clickTag))
		}
	})
	r.NotFound(s.static)
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) { s.fail(w, r, problem(405, "不支持此请求方法")) })
	s.handler = r
	return s
}
func (s *Server) handle(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			s.fail(w, r, err)
		}
	}
}
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *httpError
	if errors.Is(err, sql.ErrNoRows) {
		e = &httpError{404, "记录不存在", "NOT_FOUND"}
	} else if !errors.As(err, &e) {
		s.log.Error("请求失败", "method", r.Method, "path", r.URL.Path, "error", err)
		e = &httpError{500, "服务器内部错误", "INTERNAL_ERROR"}
	}
	_ = reply(w, e.status, object{"error": object{"code": e.code, "message": e.message}})
}
func reply(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
func success(w http.ResponseWriter, v any) error { return reply(w, 200, object{"data": v}) }
func created(w http.ResponseWriter, v any) error { return reply(w, 201, object{"data": v}) }
func empty(w http.ResponseWriter) error          { w.WriteHeader(204); return nil }
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	return decodeLimit(w, r, v, 2<<20)
}
func decodeLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(v); err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			return problem(413, "请求内容过大")
		}
		return problem(400, "请求必须包含有效的 JSON 对象")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return problem(400, "请求只能包含一个 JSON 对象")
	}
	return nil
}
func now() string      { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func str(v any) string { s, _ := v.(string); return s }
func number(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}
func boolean(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return number(v) != 0
}
func bools(row object, keys ...string) {
	for _, key := range keys {
		row[key] = boolean(row[key])
	}
}
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }
func id(r *http.Request) string { return chi.URLParam(r, "id") }
func one(r *http.Request, db database.Queryer, q string, args ...any) (object, error) {
	return database.One(r.Context(), db, q, args...)
}
func all(r *http.Request, db database.Queryer, q string, args ...any) ([]object, error) {
	return database.Query(r.Context(), db, q, args...)
}
func transaction(ctx context.Context, db *sql.DB, f func(*sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = f(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func validURL(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && len(raw) <= 8192
}
func page(r *http.Request) (int, int, error) {
	q := r.URL.Query()
	size := 30
	offset := 0
	if v := q.Get("page_size"); v != "" {
		// 与旧实现一致：非法或 0 回退默认值，超出范围静默截断而不报错。
		n, e := strconv.Atoi(v)
		if e != nil || n == 0 {
			n = size
		}
		size = min(max(n, 1), 100)
	}
	if v := q.Get("page_cursor"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 0 {
			return 0, 0, problem(400, "分页游标无效")
		}
		offset = n
	}
	return size, offset, nil
}
func pageResult(key string, rows []object, size, offset int) object {
	more := len(rows) > size
	if more {
		rows = rows[:size]
	}
	meta := object{"page_size": size, "count": len(rows), "has_more": more}
	if more {
		meta["next_cursor"] = strconv.Itoa(offset + size)
	}
	return object{key: rows, "meta": meta}
}

// clientIP 返回请求来源地址。默认只信任 TCP 对端；对端属于 MARKVAULT_TRUSTED_PROXIES 时，
// 从 X-Forwarded-For 右侧向左跳过可信代理，取第一个不可信地址，客户端伪造的左侧内容不会被采用。
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || !s.trustedProxy(peer) {
		return host
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			// 格式错误时退回代理地址，宁可共用限流额度也不采用不可信内容。
			break
		}
		if hop = hop.Unmap(); !s.trustedProxy(hop) {
			return hop.String()
		}
	}
	return peer.Unmap().String()
}
func (s *Server) trustedProxy(address netip.Addr) bool {
	address = address.Unmap()
	for _, prefix := range s.config.TrustedProxies {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

// rateIP 是限流使用的来源标识：IPv6 按 /64 归并，同一网段轮换地址不能绕过限制。
func (s *Server) rateIP(r *http.Request) string {
	ip := s.clientIP(r)
	address, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	if address = address.Unmap(); address.Is6() {
		return netip.PrefixFrom(address, 64).Masked().String()
	}
	return address.String()
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	if err := s.db.PingContext(r.Context()); err != nil {
		return problem(503, "数据库暂不可用")
	}
	return success(w, object{"status": "ok", "backend": "go"})
}
func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' data: blob:")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			allowed := false
			for _, v := range s.config.AllowedOrigins {
				if origin == v {
					allowed = true
					break
				}
			}
			scheme := "http"
			if r.TLS != nil {
				scheme = "https"
			}
			if origin == scheme+"://"+r.Host {
				allowed = true
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, MCP-Protocol-Version")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			if r.Method == "OPTIONS" {
				if !allowed {
					s.fail(w, r, problem(403, "不允许该跨域来源"))
				} else {
					w.WriteHeader(204)
				}
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("请求发生异常", "error", fmt.Sprint(v))
				s.fail(w, r, problem(500, "服务器内部错误"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.fail(w, r, problem(404, "接口不存在"))
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		s.fail(w, r, problem(405, "不支持此请求方法"))
		return
	}
	root, err := os.OpenRoot(s.config.WebDir)
	if err != nil {
		s.fail(w, r, problem(503, "前端尚未构建，请先运行 pnpm build"))
		return
	}
	defer root.Close()
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	f, err := root.Open(filepath.FromSlash(path))
	if err == nil {
		defer f.Close()
		if st, e := f.Stat(); e == nil && !st.IsDir() {
			http.ServeContent(w, r, path, st.ModTime(), f)
			return
		}
	}
	if filepath.Ext(path) != "" && !strings.HasPrefix(path, "plugins/") && !strings.HasPrefix(path, "p/") {
		http.NotFound(w, r)
		return
	}
	index, err := root.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer index.Close()
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.html", time.Time{}, index)
}
