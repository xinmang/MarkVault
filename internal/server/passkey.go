package server

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"markvault/internal/auth"
)

const passkeyPluginID = "markvault.passkey"
const passkeyCookie = "markvault-passkey"

type passkeyUser struct {
	id, name    string
	credentials []webauthn.Credential
}

func (u *passkeyUser) WebAuthnID() []byte                         { return []byte(u.id) }
func (u *passkeyUser) WebAuthnName() string                       { return u.name }
func (u *passkeyUser) WebAuthnDisplayName() string                { return u.name }
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

// 仅接受当前站点来源；反向代理需要保留 Host，不使用客户端可伪造的转发域名。
func passkeyOrigin(r *http.Request, requireOrigin bool) (*url.URL, error) {
	raw := r.Header.Get("Origin")
	if raw == "" && !requireOrigin {
		scheme := "https"
		if host := strings.Split(r.Host, ":")[0]; host == "localhost" || host == "127.0.0.1" {
			scheme = "http"
		}
		if r.TLS != nil {
			scheme = "https"
		}
		raw = scheme + "://" + r.Host
	}
	origin, err := url.Parse(raw)
	if err != nil || origin.Host == "" || !strings.EqualFold(origin.Host, r.Host) || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" {
		return nil, problem(400, "通行密钥请求必须来自当前站点")
	}
	if origin.Scheme != "https" && !(origin.Scheme == "http" && (origin.Hostname() == "localhost" || origin.Hostname() == "127.0.0.1")) {
		return nil, problem(400, "通行密钥需要 HTTPS 或 localhost 安全环境")
	}
	return origin, nil
}

func newPasskeyRP(origin *url.URL) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID: origin.Hostname(), RPDisplayName: "MarkVault", RPOrigins: []string{origin.String()},
		AuthenticatorSelection: protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired},
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute},
			Registration: webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute},
		},
	})
}

func (s *Server) passkeyAvailable(r *http.Request, db executor, uid string) (bool, error) {
	if _, ok := s.bundle.Manifests[passkeyPluginID]; !ok {
		return false, nil
	}
	var available bool
	query := "SELECT NOT EXISTS(SELECT 1 FROM plugin_installations WHERE plugin_id=? AND disabled=1) AND EXISTS(SELECT 1 FROM plugin_users WHERE plugin_id=? AND enabled=1 AND user_id=?)"
	args := []any{passkeyPluginID, passkeyPluginID, uid}
	if uid == "" {
		query = "SELECT NOT EXISTS(SELECT 1 FROM plugin_installations WHERE plugin_id=? AND disabled=1) AND EXISTS(SELECT 1 FROM passkey_credentials c JOIN plugin_users p ON p.user_id=c.user_id WHERE p.plugin_id=? AND p.enabled=1)"
		args = args[:2]
	}
	err := db.QueryRowContext(r.Context(), query, args...).Scan(&available)
	return available, err
}

func (s *Server) requirePasskey(r *http.Request, db executor, uid string) error {
	enabled, err := s.passkeyAvailable(r, db, uid)
	if err != nil {
		return err
	}
	if !enabled {
		return problem(403, "通行密钥插件未启用")
	}
	return nil
}

func (s *Server) loadPasskeyUser(r *http.Request, uid, rpID string) (*passkeyUser, error) {
	user := &passkeyUser{id: uid}
	if err := s.db.QueryRowContext(r.Context(), "SELECT username FROM users WHERE id=?", uid).Scan(&user.name); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT credential FROM passkey_credentials WHERE user_id=? AND rp_id=?", uid, rpID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var credential webauthn.Credential
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &credential); err != nil {
			return nil, err
		}
		user.credentials = append(user.credentials, credential)
	}
	return user, rows.Err()
}

type passkeySession struct {
	Kind         string
	UserID       string
	Origin       string
	Data         webauthn.SessionData
	Name         string
	AuthToken    string
	PasswordHash string
}

func (s *Server) savePasskeySession(w http.ResponseWriter, r *http.Request, origin *url.URL, session passkeySession, options any) error {
	id, err := auth.RandomToken(32)
	if err != nil {
		return err
	}
	binding, err := auth.RandomToken(32)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(session.Data)
	if err != nil {
		return err
	}
	if _, err = s.db.ExecContext(r.Context(), "DELETE FROM passkey_sessions WHERE expires_at<=?", time.Now().Unix()); err != nil {
		return err
	}
	_, err = s.db.ExecContext(r.Context(), "INSERT INTO passkey_sessions(id,kind,user_id,binding,origin,session,name,auth_token,password_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)", auth.HashToken(id), session.Kind, session.UserID, auth.HashToken(binding), origin.String(), string(raw), session.Name, session.AuthToken, session.PasswordHash, time.Now().Add(5*time.Minute).Unix())
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: passkeyCookie, Value: binding, Path: "/api/v1/auth/passkey/", MaxAge: 300, HttpOnly: true, Secure: origin.Scheme == "https", SameSite: http.SameSiteStrictMode})
	w.Header().Set("Cache-Control", "no-store")
	return success(w, object{"session_id": id, "options": options})
}

type passkeyFinish struct {
	SessionID  string          `json:"session_id"`
	Credential json.RawMessage `json:"credential"`
}

// 先原子消费挑战，再校验响应；失败、重放、跨浏览器和过期请求均不能重复使用。
func (s *Server) takePasskeySession(r *http.Request, id, kind, uid string) (*passkeySession, error) {
	origin, err := passkeyOrigin(r, true)
	if err != nil {
		return nil, err
	}
	cookie, err := r.Cookie(passkeyCookie)
	if err != nil || len(id) > 128 || len(cookie.Value) > 128 {
		return nil, problem(400, "通行密钥验证已失效，请重新开始")
	}
	session := &passkeySession{}
	var raw string
	err = s.db.QueryRowContext(r.Context(), "DELETE FROM passkey_sessions WHERE id=? AND kind=? AND user_id=? AND binding=? AND origin=? AND expires_at>? RETURNING kind,user_id,origin,session,name,auth_token,password_hash", auth.HashToken(id), kind, uid, auth.HashToken(cookie.Value), origin.String(), time.Now().Unix()).Scan(&session.Kind, &session.UserID, &session.Origin, &raw, &session.Name, &session.AuthToken, &session.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, problem(400, "通行密钥验证已失效，请重新开始")
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(raw), &session.Data); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *Server) checkPasskeyPassword(w http.ResponseWriter, r *http.Request, password string) (string, error) {
	if err := jwtOnly(r); err != nil {
		return "", err
	}
	if err := s.rate(r, w, "passkey-password:"+userID(r), 5, 60); err != nil {
		return "", err
	}
	var hash string
	if err := s.db.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=?", userID(r)).Scan(&hash); err != nil {
		return "", err
	}
	if len(password) > 1024 || !auth.VerifyPassword(password, hash) {
		return "", problem(403, "当前密码不正确")
	}
	return hash, nil
}

func (s *Server) passkeyList(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	rows, err := all(r, s.db, "SELECT id,name,rp_id,created_at,last_used_at FROM passkey_credentials WHERE user_id=? ORDER BY created_at", userID(r))
	if err != nil {
		return err
	}
	return success(w, object{"credentials": rows})
}

func (s *Server) passkeyRegisterBegin(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requirePasskey(r, s.db, userID(r)); err != nil {
		return err
	}
	origin, err := passkeyOrigin(r, true)
	if err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	body.Name = strings.TrimSpace(body.Name)
	if utf8.RuneCountInString(body.Name) < 1 || utf8.RuneCountInString(body.Name) > 64 {
		return problem(400, "密钥名称需为 1–64 个字符")
	}
	hash, err := s.checkPasskeyPassword(w, r, body.Password)
	if err != nil {
		return err
	}
	user, err := s.loadPasskeyUser(r, userID(r), origin.Hostname())
	if err != nil {
		return err
	}
	if len(user.credentials) >= 20 {
		return problem(400, "每个站点最多绑定 20 个通行密钥")
	}
	rp, err := newPasskeyRP(origin)
	if err != nil {
		return err
	}
	excluded := []protocol.CredentialDescriptor{}
	for _, credential := range user.credentials {
		excluded = append(excluded, credential.Descriptor())
	}
	options, session, err := rp.BeginRegistration(user, webauthn.WithExclusions(excluded))
	if err != nil {
		return err
	}
	return s.savePasskeySession(w, r, origin, passkeySession{Kind: "register", UserID: user.id, Data: *session, Name: body.Name, AuthToken: auth.HashToken(who(r).Token), PasswordHash: hash}, options)
}

func (s *Server) passkeyRegisterFinish(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.rate(r, w, "passkey-finish:"+s.rateIP(r), 30, 60); err != nil {
		return err
	}
	var body passkeyFinish
	if err := decode(w, r, &body); err != nil {
		return err
	}
	session, err := s.takePasskeySession(r, body.SessionID, "register", userID(r))
	if err != nil {
		return err
	}
	if session.AuthToken != auth.HashToken(who(r).Token) {
		return problem(403, "登录会话已变化，请重新绑定密钥")
	}
	origin, _ := url.Parse(session.Origin)
	rp, err := newPasskeyRP(origin)
	if err != nil {
		return err
	}
	user, err := s.loadPasskeyUser(r, userID(r), origin.Hostname())
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body.Credential)
	if err != nil {
		return problem(400, "通行密钥响应无效")
	}
	credential, err := rp.CreateCredential(user, session.Data, parsed)
	if err != nil {
		return problem(400, "通行密钥验证失败，请重新绑定")
	}
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if err := s.requirePasskey(r, tx, user.id); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE id=? AND password_hash=? AND NOT EXISTS(SELECT 1 FROM auth_versions WHERE user_id=? AND version<>?) AND NOT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE token_hash=?)", user.id, session.PasswordHash, user.id, who(r).Claims.Version, session.AuthToken).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return problem(403, "账号验证已失效，请重新绑定")
		}
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM passkey_credentials WHERE user_id=? AND rp_id=?", user.id, origin.Hostname()).Scan(&count); err != nil {
			return err
		}
		if count >= 20 {
			return problem(400, "每个站点最多绑定 20 个通行密钥")
		}
		result, err := tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO passkey_credentials(id,user_id,rp_id,name,credential,created_at) VALUES(?,?,?,?,?,?)", base64.RawURLEncoding.EncodeToString(credential.ID), user.id, origin.Hostname(), session.Name, string(raw), now())
		if err != nil {
			return err
		}
		inserted, _ := result.RowsAffected()
		if inserted != 1 {
			return problem(409, "该通行密钥已绑定")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return created(w, object{"name": session.Name})
}

func (s *Server) passkeyDelete(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	hash, err := s.checkPasskeyPassword(w, r, body.Password)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(r.Context(), "DELETE FROM passkey_credentials WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)", id(r), userID(r), userID(r), hash)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return problem(404, "密钥不存在或账号验证已失效")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) passkeyLoginBegin(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, w, "passkey-login:"+s.rateIP(r), 20, 60); err != nil {
		return err
	}
	if err := s.requirePasskey(r, s.db, ""); err != nil {
		return err
	}
	origin, err := passkeyOrigin(r, true)
	if err != nil {
		return err
	}
	rp, err := newPasskeyRP(origin)
	if err != nil {
		return err
	}
	options, session, err := rp.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return err
	}
	return s.savePasskeySession(w, r, origin, passkeySession{Kind: "login", Data: *session}, options)
}

func (s *Server) passkeyLoginFinish(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, w, "passkey-finish:"+s.rateIP(r), 30, 60); err != nil {
		return err
	}
	var body passkeyFinish
	if err := decode(w, r, &body); err != nil {
		return err
	}
	session, err := s.takePasskeySession(r, body.SessionID, "login", "")
	if err != nil {
		return err
	}
	origin, _ := url.Parse(session.Origin)
	rp, err := newPasskeyRP(origin)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body.Credential)
	if err != nil {
		return problem(400, "通行密钥响应无效")
	}
	var previous string
	var version int64
	user, credential, err := rp.ValidatePasskeyLogin(func(rawID, handle []byte) (webauthn.User, error) {
		var uid string
		if err := s.db.QueryRowContext(r.Context(), "SELECT c.user_id,c.credential,COALESCE(v.version,0) FROM passkey_credentials c LEFT JOIN auth_versions v ON v.user_id=c.user_id WHERE c.id=? AND c.rp_id=?", base64.RawURLEncoding.EncodeToString(rawID), origin.Hostname()).Scan(&uid, &previous, &version); err != nil {
			return nil, err
		}
		if !bytes.Equal([]byte(uid), handle) {
			return nil, errors.New("账号不匹配")
		}
		return s.loadPasskeyUser(r, uid, origin.Hostname())
	}, session.Data, parsed)
	if err != nil || credential == nil || credential.Authenticator.CloneWarning {
		return problem(401, "通行密钥登录失败，请重试或使用密码登录")
	}
	uid := string(user.WebAuthnID())
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	var tokens object
	var profile object
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		// 更新计数器与签发令牌在同一事务内，删除、停用或撤销会话后不再签发。
		result, err := tx.ExecContext(r.Context(), "UPDATE passkey_credentials SET credential=?,last_used_at=? WHERE id=? AND user_id=? AND credential=? AND NOT EXISTS(SELECT 1 FROM auth_versions WHERE user_id=? AND version<>?)", string(raw), now(), base64.RawURLEncoding.EncodeToString(credential.ID), uid, previous, uid, version)
		if err != nil {
			return err
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			return problem(401, "密钥状态已变化，请重新登录")
		}
		if err := s.requirePasskey(r, tx, uid); err != nil {
			return err
		}
		profile, err = one(r, tx, "SELECT id,username,email,role,created_at FROM users WHERE id=?", uid)
		if err != nil {
			return err
		}
		tokens, err = s.issue(r, tx, uid)
		return err
	})
	if err != nil {
		return err
	}
	tokens["user"] = profile
	return success(w, tokens)
}
