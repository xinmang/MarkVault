package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"markvault/internal/auth"
)

type principal struct {
	UserID      string
	APIKeyID    string
	Permissions []string
	Token       string
	Claims      *auth.Claims
}
type authContextKey struct{}

func who(r *http.Request) *principal { return r.Context().Value(authContextKey{}).(*principal) }
func userID(r *http.Request) string  { return who(r).UserID }
func permit(r *http.Request, permission string) error {
	p := who(r)
	if p.APIKeyID == "" {
		return nil
	}
	for _, value := range p.Permissions {
		if value == permission || value == strings.Split(permission, ".")[0]+".*" {
			return nil
		}
	}
	return &httpError{403, "API Key 缺少权限: " + permission, "INSUFFICIENT_PERMISSIONS"}
}
func jwtOnly(r *http.Request) error {
	if who(r).APIKeyID != "" {
		return problem(403, "此操作需要登录凭据")
	}
	return nil
}
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := &principal{}
		response := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		handler := s.handle(func(w http.ResponseWriter, r *http.Request) error {
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			key := r.Header.Get("X-API-Key")
			if key == "" && (strings.HasPrefix(token, "mvk_") || strings.HasPrefix(token, "tmk_")) {
				key = token
			}
			if key != "" {
				row, err := one(r, s.db, "SELECT id,user_id,permissions FROM api_keys WHERE key_hash=? AND status='active' AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))", auth.HashAPIKey(key))
				if errors.Is(err, sql.ErrNoRows) {
					return problem(401, "API Key 无效或已过期")
				}
				if err != nil {
					return err
				}
				p.UserID = str(row["user_id"])
				p.APIKeyID = str(row["id"])
				if err := json.Unmarshal([]byte(str(row["permissions"])), &p.Permissions); err != nil {
					return problem(401, "API Key 权限数据无效")
				}
				if err := s.rate(r, w, "key:"+p.APIKeyID, 300, 60); err != nil {
					return err
				}
				if _, err := s.db.ExecContext(r.Context(), "UPDATE api_keys SET last_used_at=?,last_used_ip=? WHERE id=?", now(), s.clientIP(r), p.APIKeyID); err != nil {
					return err
				}
			} else {
				if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
					return problem(401, "请先登录")
				}
				claims, err := auth.Verify(token, s.config.JWTSecret)
				if err != nil {
					return problem(401, "访问令牌无效或已过期")
				}
				var valid int
				err = s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users u WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE token_hash=?) AND NOT EXISTS(SELECT 1 FROM auth_versions WHERE user_id=u.id AND version<>?)`, claims.Subject, auth.HashToken(token), claims.Version).Scan(&valid)
				if err != nil {
					return err
				}
				if valid != 1 {
					return problem(401, "登录状态已失效")
				}
				p.UserID = claims.Subject
				p.Token = token
				p.Claims = claims
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, p)))
			return nil
		})
		// 异常响应也需经过状态码记录器，日志才能反映最终返回的状态。
		s.recover(handler).ServeHTTP(response, r)
		if p.APIKeyID != "" {
			status := response.Status()
			if status == 0 {
				status = http.StatusOK
			}
			s.logAPIKey(r, p, status)
		}
	})
}
func (s *Server) rate(r *http.Request, w http.ResponseWriter, key string, limit, seconds int) error {
	stamp := time.Now().Unix()
	// 最多每分钟清理一批过期的限流记录与会话凭据，避免长期运行后无限增长。
	previous := s.lastRateCleanup.Load()
	if stamp-previous >= 60 && s.lastRateCleanup.CompareAndSwap(previous, stamp) {
		s.cleanupExpired(r.Context(), stamp)
	}
	start := stamp / int64(seconds) * int64(seconds)
	var count int
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO rate_limits(key,window_seconds,window_start,count,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(key,window_seconds,window_start) DO UPDATE SET count=count+1,updated_at=excluded.updated_at RETURNING count`, key, seconds, start, stamp).Scan(&count)
	if err != nil {
		return err
	}
	if count > limit {
		w.Header().Set("Retry-After", stringInt(start+int64(seconds)-stamp))
		return problem(429, "请求过于频繁，请稍后重试")
	}
	return nil
}

// cleanupExpired 分批删除一天前的限流记录、已过期的访问令牌吊销记录，
// 以及过期或吊销超过一天的刷新令牌（刷新时旧令牌只会被标记吊销，不会自动删除）。
func (s *Server) cleanupExpired(ctx context.Context, stamp int64) {
	statements := []struct {
		query string
		args  []any
	}{
		{"DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE updated_at<? LIMIT 1000)", []any{stamp - 86400}},
		{"DELETE FROM revoked_access_tokens WHERE rowid IN (SELECT rowid FROM revoked_access_tokens WHERE expires_at<? LIMIT 1000)", []any{stamp}},
		{"DELETE FROM auth_tokens WHERE id IN (SELECT id FROM auth_tokens WHERE julianday(expires_at)<julianday('now') OR (revoked_at IS NOT NULL AND julianday(revoked_at)<julianday('now','-1 day')) LIMIT 1000)", nil},
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			s.log.Warn("清理过期记录失败", "error", err)
		}
	}
}

// loginFailureLimit 是同一用户名在 loginFailureWindow 秒内允许的失败次数。
// 与按来源地址的限流叠加，轮换地址撞库同一个账号也会被限制；不存在的用户名同样计数，不泄漏账号是否存在。
const (
	loginFailureLimit  = 20
	loginFailureWindow = 900
)

func loginFailureKey(username string) string {
	return "login-user:" + strings.ToLower(strings.TrimSpace(username))
}

// loginLocked 只读取当前窗口的失败次数，不计入本次请求。
func (s *Server) loginLocked(r *http.Request, w http.ResponseWriter, key string) error {
	stamp := time.Now().Unix()
	start := stamp / loginFailureWindow * loginFailureWindow
	var count int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COALESCE((SELECT count FROM rate_limits WHERE key=? AND window_seconds=? AND window_start=?),0)", key, loginFailureWindow, start).Scan(&count); err != nil {
		return err
	}
	if count >= loginFailureLimit {
		w.Header().Set("Retry-After", stringInt(start+loginFailureWindow-stamp))
		return problem(429, "该账号登录失败次数过多，请稍后重试")
	}
	return nil
}

func (s *Server) recordLoginFailure(r *http.Request, key string) {
	stamp := time.Now().Unix()
	start := stamp / loginFailureWindow * loginFailureWindow
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO rate_limits(key,window_seconds,window_start,count,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(key,window_seconds,window_start) DO UPDATE SET count=count+1,updated_at=excluded.updated_at`, key, loginFailureWindow, start, stamp); err != nil {
		s.log.Warn("记录登录失败次数失败", "error", err)
	}
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

func (s *Server) register(w http.ResponseWriter, r *http.Request) error {
	if !s.config.AllowRegistration {
		return problem(403, "注册已关闭")
	}
	if err := s.rate(r, w, "register:"+s.rateIP(r), 5, 3600); err != nil {
		return err
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Email    string `json:"email"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if !usernamePattern.MatchString(body.Username) || len(body.Password) < 8 || len(body.Password) > 1024 {
		return problem(400, "用户名需为 3–20 位字母、数字或下划线，密码需为 8–1024 字节")
	}
	if body.Email != "" {
		address, e := mail.ParseAddress(body.Email)
		if e != nil || address.Address != body.Email || len(body.Email) > 255 {
			return problem(400, "邮箱格式无效")
		}
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		return err
	}
	uid := auth.ID()
	stamp := now()
	role := "user"
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		// 先写入单例标记取得写锁，再判断是否为首个账号；失败注册会连同标记一起回滚。
		claim, err := tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO instance_initialization(id) VALUES(1)")
		if err != nil {
			return err
		}
		claimed, err := claim.RowsAffected()
		if err != nil {
			return err
		}
		enabled, err := s.registrationEnabled(r, tx)
		if err != nil {
			return err
		}
		if !enabled {
			return problem(403, "注册已关闭")
		}
		if claimed == 1 {
			var count int
			if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users").Scan(&count); err != nil {
				return err
			}
			if count == 0 {
				role = "admin"
			}
		}
		var exists int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE lower(username)=lower(?) OR (email IS NOT NULL AND lower(email)=lower(?))", body.Username, nullable(body.Email)).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			return problem(409, "用户名或邮箱已存在")
		}
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO users(id,username,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", uid, body.Username, nullable(body.Email), hash, role, stamp, stamp); err != nil {
			return err
		}
		_, err = tx.ExecContext(r.Context(), "INSERT INTO user_preferences(user_id,updated_at) VALUES(?,?)", uid, stamp)
		if err == nil && role == "admin" {
			_, err = tx.ExecContext(r.Context(), "UPDATE auth_settings SET registration_enabled=0 WHERE id=1")
		}
		return err
	})
	if err != nil {
		return err
	}
	return created(w, object{"user": object{"id": uid, "username": body.Username, "email": nullable(body.Email), "role": role, "created_at": stamp}})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, w, "login:"+s.rateIP(r), 10, 60); err != nil {
		return err
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if len(body.Password) > 1024 {
		return problem(400, "密码过长")
	}
	// 用户名会成为限流记录的键，超长输入不可能是合法账号，直接拒绝。
	if len(body.Username) > 128 {
		return problem(401, "用户名或密码错误")
	}
	failureKey := loginFailureKey(body.Username)
	if err := s.loginLocked(r, w, failureKey); err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT id,username,email,role,created_at,password_hash FROM users WHERE lower(username)=lower(?)", body.Username)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	// 不存在的账号也执行摘要计算，降低基于耗时枚举用户名的差异。
	hash := auth.DummyPasswordHash()
	if err == nil {
		hash = str(row["password_hash"])
	}
	if !auth.VerifyPassword(body.Password, hash) || row == nil {
		s.recordLoginFailure(r, failureKey)
		return problem(401, "用户名或密码错误")
	}
	upgraded := hash
	if auth.PasswordNeedsRehash(hash) {
		upgraded, err = auth.HashPassword(body.Password)
		if err != nil {
			return err
		}
	}
	delete(row, "password_hash")
	var tokens object
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		// 密码升级与会话签发在同一事务中，防止并发改密后旧密码再次获得会话。
		result, err := tx.ExecContext(r.Context(), "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?", upgraded, row["id"], hash)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return problem(401, "登录凭据已变化，请重试")
		}
		tokens, err = s.issue(r, tx, str(row["id"]))
		return err
	})
	if err != nil {
		return err
	}
	tokens["user"] = row
	return success(w, tokens)
}

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Server) issue(r *http.Request, db executor, uid string) (object, error) {
	var version int64
	if err := db.QueryRowContext(r.Context(), "SELECT COALESCE((SELECT version FROM auth_versions WHERE user_id=?),0)", uid).Scan(&version); err != nil {
		return nil, err
	}
	access, err := auth.Sign(uid, s.config.JWTSecret, s.config.AccessTTL, version)
	if err != nil {
		return nil, err
	}
	refresh, err := auth.RandomToken(32)
	if err != nil {
		return nil, err
	}
	_, err = db.ExecContext(r.Context(), "INSERT INTO auth_tokens(user_id,refresh_token_hash,expires_at,created_at) VALUES(?,?,?,?)", uid, auth.HashToken(refresh), time.Now().UTC().Add(s.config.RefreshTTL).Format(time.RFC3339Nano), now())
	if err != nil {
		return nil, err
	}
	return object{"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": int64(s.config.AccessTTL.Seconds())}, nil
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, w, "refresh:"+s.rateIP(r), 30, 60); err != nil {
		return err
	}
	var body struct {
		Token string `json:"refresh_token"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if body.Token == "" {
		return problem(400, "缺少刷新令牌")
	}
	var result object
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		var uid string
		err := tx.QueryRowContext(r.Context(), `UPDATE auth_tokens SET revoked_at=? WHERE refresh_token_hash=? AND revoked_at IS NULL AND julianday(expires_at)>julianday('now') RETURNING user_id`, now(), auth.HashToken(body.Token)).Scan(&uid)
		if errors.Is(err, sql.ErrNoRows) {
			return problem(401, "刷新令牌无效或已使用")
		}
		if err != nil {
			return err
		}
		result, err = s.issue(r, tx, uid)
		return err
	})
	if err != nil {
		return err
	}
	return success(w, result)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var body struct {
		Token string `json:"refresh_token"`
		All   bool   `json:"revoke_all"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if body.Token == "" {
		return problem(400, "缺少刷新令牌")
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		q := "UPDATE auth_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL"
		args := []any{now(), userID(r)}
		if !body.All {
			q += " AND refresh_token_hash=?"
			args = append(args, auth.HashToken(body.Token))
		}
		if _, err := tx.ExecContext(r.Context(), q, args...); err != nil {
			return err
		}
		if body.All {
			if _, err := tx.ExecContext(r.Context(), "INSERT INTO auth_versions(user_id,version) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1", userID(r)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO revoked_access_tokens(token_hash,expires_at) VALUES(?,?)", auth.HashToken(who(r).Token), who(r).Claims.ExpiresAt.Unix())
		return err
	})
	if err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "user.read"); err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT id,username,email,role,created_at FROM users WHERE id=?", userID(r))
	if err != nil {
		return err
	}
	stats, err := one(r, s.db, "SELECT (SELECT COUNT(*) FROM bookmarks WHERE user_id=? AND deleted_at IS NULL) AS total_bookmarks,(SELECT COUNT(*) FROM bookmarks WHERE user_id=? AND deleted_at IS NULL AND is_pinned=1) AS pinned_bookmarks,(SELECT COUNT(*) FROM tags WHERE user_id=? AND deleted_at IS NULL) AS total_tags", userID(r), userID(r), userID(r))
	if err != nil {
		return err
	}
	row["stats"] = stats
	payload := object{"user": row}
	if who(r).APIKeyID != "" {
		payload["api_key"] = object{"id": who(r).APIKeyID, "permissions": who(r).Permissions}
	}
	return success(w, payload)
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.rate(r, w, "password:"+userID(r), 5, 60); err != nil {
		return err
	}
	var body struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if len(body.New) < 8 || len(body.New) > 1024 || len(body.Current) > 1024 {
		return problem(400, "密码需为 8–1024 字节")
	}
	var current string
	if err := s.db.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=?", userID(r)).Scan(&current); err != nil {
		return err
	}
	if !auth.VerifyPassword(body.Current, current) {
		return problem(401, "当前密码不正确")
	}
	hash, err := auth.HashPassword(body.New)
	if err != nil {
		return err
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(r.Context(), "UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND password_hash=?", hash, now(), userID(r), current)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return problem(409, "密码已变化，请重新登录")
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE auth_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now(), userID(r)); err != nil {
			return err
		}
		_, err = tx.ExecContext(r.Context(), "INSERT INTO auth_versions(user_id,version) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1", userID(r))
		return err
	})
	if err != nil {
		return err
	}
	return success(w, object{"message": "密码已更新，请重新登录"})
}
