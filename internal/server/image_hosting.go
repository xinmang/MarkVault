package server

import (
	"context"
	"crypto/hmac"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"markvault/internal/auth"
	"markvault/internal/plugin"
)

const maxHostedImageBytes = 10 << 20

type imageToHost struct {
	key, mime string
	content   []byte
}

func (s *Server) validateImageHosting(value object, grants []string) error {
	c, err := plugin.DecodeImageHostingConfig(value)
	if err != nil || s.bundle.ImageHosting == nil {
		return problem(400, "图床配置无效")
	}
	if err = s.bundle.ImageHosting.Validate(c); err != nil {
		return problem(400, err.Error())
	}
	if !plugin.Has(grants, "network.fetch") {
		return problem(400, "请明确授权图床上传所选用途的图片")
	}
	return nil
}

func (s *Server) imageHostingSettings(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), plugin.ImageHostingID)
	if err != nil {
		return err
	}
	if r.Method == "GET" {
		var has bool
		err = s.db.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name='upload')", userID(r), plugin.ImageHostingID).Scan(&has)
		if err != nil {
			return err
		}
		return success(w, object{"hasSecret": has})
	}
	var input struct {
		Enabled         bool   `json:"enabled"`
		Config          object `json:"config"`
		Secret          string `json:"secret"`
		ClearSecret     bool   `json:"clearSecret"`
		Granted         bool   `json:"granted"`
		AccessKeyID     string `json:"accessKeyId"`
		SecretAccessKey string `json:"secretAccessKey"`
	}
	if err = decode(w, r, &input); err != nil {
		return err
	}
	grants := []string{}
	if input.Granted {
		grants = append(grants, "network.fetch")
	}
	if input.Config == nil {
		input.Config = object{}
	}
	if err = validateSchema(input.Config, st.Manifest.Settings, "config"); err != nil {
		return err
	}
	c, err := plugin.DecodeImageHostingConfig(input.Config)
	if err != nil {
		return problem(400, "图床配置无效")
	}
	if input.Enabled {
		if err = s.validateImageHosting(input.Config, grants); err != nil {
			return err
		}
	} else if c.Endpoint != "" {
		if err = s.bundle.ImageHosting.Validate(c); err != nil {
			return problem(400, err.Error())
		}
	}
	if c.Backend == "s3" {
		if input.Secret != "" {
			return problem(400, "S3 请使用独立的访问密钥字段")
		}
		if input.AccessKeyID != "" || input.SecretAccessKey != "" {
			raw, _ := json.Marshal(plugin.S3Credentials{AccessKeyID: input.AccessKeyID, SecretAccessKey: input.SecretAccessKey})
			input.Secret = string(raw)
		}
	} else if input.AccessKeyID != "" || input.SecretAccessKey != "" {
		return problem(400, "HTTP 图床不接受 S3 访问密钥")
	}
	if input.Secret != "" && c.Endpoint == "" {
		return problem(400, "保存凭据前请填写图床地址")
	}
	if len(input.Secret) > 8192 || strings.ContainsAny(input.Secret, "\r\n") {
		return problem(400, "图床凭据无效")
	}
	target := hostingCredentialTarget(c)
	cipher := ""
	if input.Secret != "" {
		if err = s.bundle.ImageHosting.ValidateCredentials(c, input.Secret); err != nil {
			return problem(400, err.Error())
		}
		cipher, err = auth.Encrypt(input.Secret, s.config.EncryptionKey)
		if err != nil {
			return err
		}
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if input.ClearSecret || input.Secret != "" {
			if _, e := tx.ExecContext(r.Context(), "DELETE FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name='upload'", userID(r), plugin.ImageHostingID); e != nil {
				return e
			}
		} else {
			// 地址切换后不沿用旧来源的密钥。
			if _, e := tx.ExecContext(r.Context(), "DELETE FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name='upload' AND target<>?", userID(r), plugin.ImageHostingID, target); e != nil {
				return e
			}
		}
		if cipher != "" && !input.ClearSecret {
			if _, e := tx.ExecContext(r.Context(), "INSERT INTO plugin_credentials(user_id,plugin_id,name,target,ciphertext) VALUES(?,?,'upload',?,?)", userID(r), plugin.ImageHostingID, target, cipher); e != nil {
				return e
			}
		}
		if c.Backend == "s3" && input.Enabled {
			var stored string
			if e := tx.QueryRowContext(r.Context(), "SELECT ciphertext FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name='upload' AND target=?", userID(r), plugin.ImageHostingID, target).Scan(&stored); e != nil {
				return problem(400, "启用 S3 前请填写 Access Key ID 和 Secret Access Key")
			}
		}
		_, e := tx.ExecContext(r.Context(), `INSERT INTO plugin_users(user_id,plugin_id,enabled,config,grants,last_error) VALUES(?,?,?,?,?,'') ON CONFLICT(user_id,plugin_id) DO UPDATE SET enabled=excluded.enabled,config=excluded.config,grants=excluded.grants,last_error='',generation=plugin_users.generation+1`, userID(r), plugin.ImageHostingID, input.Enabled, mustJSON(input.Config), mustJSON(grants))
		return e
	})
	if err != nil {
		return err
	}
	s.stopPlugins(userID(r), plugin.ImageHostingID)
	return success(w, object{"saved": true})
}

func hostingCredentialTarget(c plugin.ImageHostingConfig) string {
	u, err := url.Parse(c.Endpoint)
	if err != nil {
		return ""
	}
	origin := u.Scheme + "://" + u.Host
	if c.Backend == "s3" {
		return "s3:" + origin
	}
	return origin
}

// hostingConfig 同时检查用户用途、实例禁用和主动授权；内置身份不跳过上传授权。
func (s *Server) hostingConfig(r *http.Request, purpose string) (plugin.State, plugin.ImageHostingConfig, bool) {
	st, err := s.plugins.Get(r.Context(), userID(r), plugin.ImageHostingID)
	if err != nil || st.Status != "running" || !plugin.Has(st.Grants, "network.fetch") || s.bundle.ImageHosting == nil {
		return st, plugin.ImageHostingConfig{}, false
	}
	c, err := plugin.DecodeImageHostingConfig(st.Config)
	return st, c, err == nil && plugin.Has(c.Purposes, purpose) && s.bundle.ImageHosting.Validate(c) == nil
}

// hostImages 在本地事务提交后上传，失败保留本地文件；整个批次最多等待 30 秒。
func (s *Server) hostImages(r *http.Request, purpose string, images []imageToHost) {
	st, c, enabled := s.hostingConfig(r, purpose)
	if !enabled || len(images) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	ctx, release := s.pluginRuntime.Track(ctx, userID(r), plugin.ImageHostingID)
	defer release()
	secret := ""
	if c.AuthHeader != "" || c.Backend == "s3" {
		var target, cipher string
		e := s.db.QueryRowContext(ctx, "SELECT target,ciphertext FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name='upload'", userID(r), plugin.ImageHostingID).Scan(&target, &cipher)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			s.imageHostingFailure(r)
			return
		}
		if e == nil {
			if target != hostingCredentialTarget(c) {
				s.imageHostingFailure(r)
				return
			}
			secret, e = auth.Decrypt(cipher, s.config.EncryptionKey)
			if e != nil {
				s.imageHostingFailure(r)
				return
			}
		}
	}
	// 虚拟主机式 S3 的实际目标包含桶名前缀，管理员白名单按实际 HTTPS 来源匹配。
	clientTarget := c.Endpoint
	if c.Backend == "s3" && !c.PathStyle {
		u, _ := url.Parse(c.Endpoint)
		u.Host = c.Bucket + "." + u.Host
		clientTarget = u.String()
	}
	client := s.imageClient(clientTarget)
	defer client.CloseIdleConnections()
	storedConfig, storedCipher := "{}", ""
	if c.Backend == "s3" && c.PublicURL == "" {
		encoded, _ := json.Marshal(c)
		storedConfig = string(encoded)
		var err error
		storedCipher, err = auth.Encrypt(secret, s.config.EncryptionKey)
		if err != nil {
			s.imageHostingFailure(r)
			return
		}
	}
	failed := false
	for _, image := range images {
		current, e := s.plugins.Get(ctx, userID(r), plugin.ImageHostingID)
		if e != nil || current.Status != "running" || current.Revision != st.Revision {
			failed = true
			break
		}
		address, e := s.bundle.ImageHosting.Upload(ctx, client, c, secret, image.mime, image.content)
		if e != nil {
			failed = true
			break
		}
		// 确认远端图片可读取且仍为图片后才移除本地副本；私有 S3 读取单独签名。
		_, _, e = s.fetchStoredImage(ctx, address, storedConfig, storedCipher)
		if e != nil {
			failed = true
			break
		}
		current, e = s.plugins.Get(ctx, userID(r), plugin.ImageHostingID)
		if e != nil || current.Status != "running" || current.Revision != st.Revision {
			failed = true
			break
		}
		e = transaction(ctx, s.db, func(tx *sql.Tx) error {
			var generation int
			var active bool
			if err := tx.QueryRowContext(ctx, "SELECT enabled,generation FROM plugin_users WHERE user_id=? AND plugin_id=?", userID(r), plugin.ImageHostingID).Scan(&active, &generation); err != nil {
				return err
			}
			if !active || !strings.HasSuffix(st.Revision, ":"+strconv.Itoa(generation)) {
				return errors.New("图床配置已变化")
			}
			referenced, e := imageObjectReferenced(ctx, tx, image.key)
			if e != nil || !referenced {
				return e
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO image_host_objects(r2_key,user_id,purpose,url,created_at,config,ciphertext) VALUES(?,?,?,?,?,?,?)", image.key, userID(r), purpose, address, now(), storedConfig, storedCipher)
			return e
		})
		if e != nil {
			failed = true
			break
		}
		// 只有持久化成功后才删除本地副本，避免事务失败丢图。
		s.removeObjects([]string{image.key})
	}
	if failed {
		s.imageHostingFailure(r)
	} else {
		_, _ = s.db.ExecContext(r.Context(), "UPDATE plugin_users SET last_error='' WHERE user_id=? AND plugin_id=?", userID(r), plugin.ImageHostingID)
	}
}

func (s *Server) imageHostingFailure(r *http.Request) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Second)
	defer cancel()
	_, _ = s.db.ExecContext(ctx, "UPDATE plugin_users SET last_error=? WHERE user_id=? AND plugin_id=?", "部分图片上传失败，已保留原图 / Some uploads failed; original images were retained", userID(r), plugin.ImageHostingID)
}

func imageObjectReferenced(ctx context.Context, tx *sql.Tx, key string) (bool, error) {
	var exists bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM bookmark_images WHERE r2_key=? UNION ALL SELECT 1 FROM bookmark_snapshots WHERE r2_key=? UNION ALL SELECT 1 FROM snapshot_images WHERE r2_key=? UNION ALL SELECT 1 FROM bookmark_screenshots WHERE r2_key=? UNION ALL SELECT 1 FROM plugin_default_images WHERE r2_key=?)`, key, key, key, key, key).Scan(&exists)
	return exists, err
}

func (s *Server) fetchHostingImage(ctx context.Context, address string) ([]byte, string, error) {
	return s.fetchStoredImage(ctx, address, "{}", "")
}

func (s *Server) fetchStoredImage(ctx context.Context, address, savedConfig, cipher string) ([]byte, string, error) {
	u, err := url.Parse(address)
	if err != nil || len(address) > 8192 || pluginTarget(u) != nil {
		return nil, "", problem(400, "图片地址无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, "", err
	}
	if cipher != "" {
		var c plugin.ImageHostingConfig
		if json.Unmarshal([]byte(savedConfig), &c) != nil || c.Backend != "s3" || c.PublicURL != "" {
			return nil, "", problem(502, "图床读取配置无效")
		}
		secret, e := auth.Decrypt(cipher, s.config.EncryptionKey)
		if e != nil {
			return nil, "", problem(502, "图床读取凭据无效")
		}
		req, e = s.bundle.ImageHosting.ReadRequest(ctx, c, secret, address)
		if e != nil {
			return nil, "", problem(502, "图床读取签名失败")
		}
	}
	client := s.imageClient(address)
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", problem(502, "读取图床图片失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, "", problem(502, "图床图片不可用")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxHostedImageBytes+1))
	if err != nil || len(raw) > maxHostedImageBytes {
		return nil, "", problem(502, "图床图片超过 10 MiB 或读取失败")
	}
	mime, ok := snapshotImageMIME(raw, resp.Header.Get("Content-Type"))
	if !ok {
		return nil, "", problem(502, "远端内容不是有效图片")
	}
	return raw, mime, nil
}

func (s *Server) defaultImageURL(r *http.Request, list []plugin.State) string {
	enabled := false
	for _, st := range list {
		if st.Manifest.ID == plugin.ImageHostingID && st.Status == "running" {
			enabled = true
		}
	}
	if !enabled {
		return ""
	}
	var key string
	if s.db.QueryRowContext(r.Context(), "SELECT r2_key FROM plugin_default_images WHERE user_id=?", userID(r)).Scan(&key) != nil {
		return ""
	}
	exp := stringInt((time.Now().Unix()/3600 + 2) * 3600)
	q := url.Values{"u": {userID(r)}, "k": {key}, "exp": {exp}}
	q.Set("sig", s.signature("default-image:"+userID(r)+":"+key+":"+exp))
	return "/api/default-bookmark-image?" + q.Encode()
}

func (s *Server) defaultImage(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	uid, key, expiry := q.Get("u"), q.Get("k"), q.Get("exp")
	exp, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil || exp <= time.Now().Unix() || !hmac.Equal([]byte(q.Get("sig")), []byte(s.signature("default-image:"+uid+":"+key+":"+expiry))) {
		return problem(401, "图片签名无效或已过期")
	}
	var mime string
	if err = s.db.QueryRowContext(r.Context(), "SELECT mime_type FROM plugin_default_images WHERE user_id=? AND r2_key=?", uid, key).Scan(&mime); err != nil {
		return err
	}
	return s.serveObjectCache(w, r, key, mime, "private, max-age=3600")
}

func (s *Server) uploadDefaultImage(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requirePlugin(r, plugin.ImageHostingID); err != nil {
		return err
	}
	var input screenshotInput
	if err := decodeLimit(w, r, &input, 3<<20); err != nil {
		return err
	}
	content, err := decodeImageData(input.Image)
	mime, _, _, ok := screenshotImageInfo(content)
	if err != nil || !ok || len(content) > 2<<20 {
		return problem(400, "默认图须为不超过 2 MiB 的 PNG、JPEG 或 WebP")
	}
	key := "blobs/" + auth.ID()
	committed := false
	defer func() {
		if !committed {
			s.removeObjects([]string{key})
		}
	}()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		var used, old int64
		if e := tx.QueryRowContext(r.Context(), storageUsedQuery).Scan(&used); e != nil {
			return e
		}
		e := tx.QueryRowContext(r.Context(), "SELECT file_size FROM plugin_default_images WHERE user_id=?", userID(r)).Scan(&old)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		if s.config.StorageLimit > 0 && int64(len(content)) > s.config.StorageLimit-used+old {
			return problem(413, "存储配额不足")
		}
		if e = s.writeObject(key, content); e != nil {
			return e
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM plugin_default_images WHERE user_id=?", userID(r)); e != nil {
			return e
		}
		_, e = tx.ExecContext(r.Context(), "INSERT INTO plugin_default_images(user_id,r2_key,mime_type,file_size) VALUES(?,?,?,?)", userID(r), key, mime, len(content))
		return e
	})
	if err != nil {
		return err
	}
	committed = true
	s.hostImages(r, "default", []imageToHost{{key, mime, content}})
	s.drainGarbage(r.Context())
	return success(w, object{"saved": true})
}

func (s *Server) deleteDefaultImage(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM plugin_default_images WHERE user_id=?", userID(r)); err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"deleted": true})
}

// 只处理此次明确保存的远端封面或图标，下载及上传均在书签事务之外完成。
func (s *Server) hostBookmarkImages(r *http.Request, bid string, fields object) {
	for field, purpose := range map[string]string{"cover_image": "cover", "favicon": "favicon"} {
		raw, ok := fields[field].(string)
		if !ok || !strings.HasPrefix(raw, "https://") {
			continue
		}
		if _, _, enabled := s.hostingConfig(r, purpose); !enabled {
			continue
		}
		content, mime, err := s.fetchHostingImage(r.Context(), raw)
		if err != nil {
			s.imageHostingFailure(r)
			continue
		}
		key, imageID := "blobs/"+auth.ID(), auth.ID()
		saved := false
		err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
			var used int64
			if e := tx.QueryRowContext(r.Context(), storageUsedQuery).Scan(&used); e != nil {
				return e
			}
			if s.config.StorageLimit > 0 && int64(len(content)) > s.config.StorageLimit-used {
				return problem(413, "存储配额不足")
			}
			// 并发编辑不能被较晚完成的下载覆盖。
			result, e := tx.ExecContext(r.Context(), "UPDATE bookmarks SET "+field+"=? WHERE id=? AND user_id=? AND "+field+"=? AND deleted_at IS NULL", bookmarkImagePrefix+imageID, bid, userID(r), raw)
			if e != nil {
				return e
			}
			n, e := result.RowsAffected()
			if e != nil || n == 0 {
				return e
			}
			if e = s.writeObject(key, content); e != nil {
				return e
			}
			_, e = tx.ExecContext(r.Context(), "INSERT INTO bookmark_images(id,bookmark_id,user_id,image_hash,r2_key,file_size,mime_type,original_url) VALUES(?,?,?,?,?,?,?,?)", imageID, bid, userID(r), imageID, key, len(content), mime, raw)
			saved = e == nil
			return e
		})
		if err != nil || !saved {
			s.removeObjects([]string{key})
			if err != nil {
				s.imageHostingFailure(r)
			}
			continue
		}
		s.hostImages(r, purpose, []imageToHost{{key, mime, content}})
	}
	// 新封面或清空字段后回收本插件生成的旧图片，不累积无引用的图床映射。
	_, coverChanged := fields["cover_image"]
	_, iconChanged := fields["favicon"]
	if coverChanged || iconChanged {
		_, err := s.db.ExecContext(r.Context(), `DELETE FROM bookmark_images AS i WHERE i.bookmark_id=? AND i.user_id=? AND i.image_hash=i.id AND i.r2_key LIKE 'blobs/%' AND NOT EXISTS(SELECT 1 FROM bookmarks b WHERE b.id=i.bookmark_id AND b.user_id=i.user_id AND (b.cover_image=?||i.image_hash OR b.favicon=?||i.image_hash))`, bid, userID(r), bookmarkImagePrefix, bookmarkImagePrefix)
		if err == nil {
			s.drainGarbage(r.Context())
		}
	}
}
