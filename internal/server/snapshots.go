package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
	"markvault/internal/database"
)

const snapshotCSP = "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline' 'self'; font-src 'self' data:; frame-src 'none'; frame-ancestors 'self'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"
const bookmarkImagePrefix = "/api/bookmark-images/images/"

// storageUsedQuery 统计受配额约束的文件逻辑大小，图床和本地采用同一口径。
const storageUsedQuery = "SELECT (SELECT COALESCE(SUM(file_size),0) FROM bookmark_snapshots)+(SELECT COALESCE(SUM(file_size),0) FROM bookmark_images)+(SELECT COALESCE(SUM(file_size),0) FROM bookmark_screenshots)+(SELECT COALESCE(SUM(file_size),0) FROM plugin_default_images)"

var imageHashPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)
var snapshotImageURL = regexp.MustCompile(`/api/snapshot-images/([a-zA-Z0-9._-]+)(?:\?[^"'\s<>)]*)?`)

func (s *Server) objectRoot() (*os.Root, error) {
	dir := filepath.Join(s.config.DataDir, "objects")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return os.OpenRoot(dir)
}
func (s *Server) writeObject(key string, content []byte) error {
	root, err := s.objectRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	if err = root.MkdirAll(filepath.Dir(key), 0700); err != nil {
		return err
	}
	f, err := root.OpenFile(key, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(content)
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err != nil {
		_ = root.Remove(key)
	}
	return err
}
func (s *Server) removeObjects(keys []string) {
	root, err := s.objectRoot()
	if err != nil {
		return
	}
	defer root.Close()
	for _, key := range keys {
		if err := root.Remove(key); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.log.Warn("清理本地文件失败", "key", key, "error", err)
		}
	}
}
func (s *Server) drainGarbage(ctx context.Context) {
	rows, err := database.Query(ctx, s.db, "SELECT r2_key FROM object_gc LIMIT 1000")
	if err != nil {
		s.log.Warn("读取文件清理队列失败", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}
	root, err := s.objectRoot()
	if err != nil {
		return
	}
	defer root.Close()
	for _, row := range rows {
		key := str(row["r2_key"])
		// 引用检查和文件删除共用数据库事务，阻止并发请求重新引用待删文件。
		err = transaction(ctx, s.db, func(tx *sql.Tx) error {
			referenced, err := imageObjectReferenced(ctx, tx, key)
			if err != nil {
				return err
			}
			if !referenced {
				if _, err := tx.ExecContext(ctx, "DELETE FROM image_host_objects WHERE r2_key=?", key); err != nil {
					return err
				}
				if err := root.Remove(key); err != nil && !errors.Is(err, os.ErrNotExist) {
					return err
				}
			}
			// 仍被引用的文件由最后一次引用删除时重新入队，避免占满清理批次。
			_, err = tx.ExecContext(ctx, "DELETE FROM object_gc WHERE r2_key=?", key)
			return err
		})
		if err != nil {
			s.log.Warn("删除文件失败，将在下次清理时重试", "key", key, "error", err)
		}
	}
}
func (s *Server) signature(message string) string {
	h := hmac.New(sha256.New, []byte(s.config.JWTSecret))
	h.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func bookmarkImageHash(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, bookmarkImagePrefix) {
		return ""
	}
	hash := strings.TrimPrefix(u.Path, bookmarkImagePrefix)
	if !imageHashPattern.MatchString(hash) {
		return ""
	}
	return hash
}

func (s *Server) signBookmarkImages(uid string, rows []object, scope string) {
	exp := stringInt(time.Now().Add(time.Hour).Unix())
	for _, row := range rows {
		bid := str(row["id"])
		for _, field := range []string{"cover_image", "favicon"} {
			hash := bookmarkImageHash(str(row[field]))
			if hash == "" {
				continue
			}
			q := url.Values{"u": {uid}, "b": {bid}, "scope": {scope}, "exp": {exp}}
			q.Set("sig", s.signature("bookmark-image:"+hash+":"+uid+":"+bid+":"+scope+":"+exp))
			row[field] = bookmarkImagePrefix + hash + "?" + q.Encode()
		}
	}
}

func (s *Server) snapshotLink(uid, bid, sid string) string {
	exp := strconv.FormatInt(time.Now().Add(24*time.Hour).Unix(), 10)
	q := url.Values{"u": {uid}, "a": {"view"}, "exp": {exp}, "sig": {s.signature(uid + ":" + sid + ":" + exp + ":view")}}
	return "/api/v1/bookmarks/" + url.PathEscape(bid) + "/snapshots/" + url.PathEscape(sid) + "/view?" + q.Encode()
}
func (s *Server) snapshotResponse(uid, bid string, row object) object {
	result := copyFields(row, "id", "version", "file_size", "content_hash", "snapshot_title", "is_latest", "created_at")
	bools(result, "is_latest")
	result["view_url"] = s.snapshotLink(uid, bid, str(row["id"]))
	return result
}
func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	if _, err := one(r, s.db, "SELECT id FROM bookmarks WHERE id=? AND user_id=? AND deleted_at IS NULL", id(r), userID(r)); err != nil {
		return err
	}
	rows, err := all(r, s.db, "SELECT * FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=? ORDER BY version DESC", id(r), userID(r))
	if err != nil {
		return err
	}
	out := []object{}
	for _, row := range rows {
		out = append(out, s.snapshotResponse(userID(r), id(r), row))
	}
	return success(w, object{"snapshots": out, "total": len(out)})
}

type snapshotInput struct {
	HTML   string `json:"html_content"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Force  bool   `json:"force"`
	Images []struct {
		Hash string `json:"hash"`
		Data string `json:"data"`
		Type string `json:"type"`
	} `json:"images"`
}
type snapshotImage struct {
	hash, key, mime string
	content         []byte
}

func reconcileSnapshots(r *http.Request, tx *sql.Tx, bid, uid string) error {
	_, err := tx.ExecContext(r.Context(), `UPDATE bookmark_snapshots SET is_latest=(id=(SELECT id FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=? ORDER BY version DESC LIMIT 1)) WHERE bookmark_id=? AND user_id=?`, bid, uid, bid, uid)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE bookmarks SET snapshot_count=(SELECT COUNT(*) FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=?),has_snapshot=EXISTS(SELECT 1 FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=?),latest_snapshot_at=(SELECT MAX(created_at) FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=?) WHERE id=? AND user_id=?`, bid, uid, bid, uid, bid, uid, bid, uid)
	return err
}
func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.create"); err != nil {
		return err
	}
	// 单个快照请求可达 75 MB，解码后的图片还会再占一份内存，排队处理以免并发上传耗尽内存。
	select {
	case s.snapshotSlots <- struct{}{}:
		defer func() { <-s.snapshotSlots }()
	case <-r.Context().Done():
		return r.Context().Err()
	}
	var input snapshotInput
	if err := decodeLimit(w, r, &input, 75<<20); err != nil {
		return err
	}
	if input.HTML == "" || len(input.HTML) > 50<<20 || input.Title == "" || len(input.Title) > 1500 || !validURL(input.URL) || len(input.Images) > 500 {
		return problem(400, "快照内容无效或超过限制")
	}
	digest := sha256.Sum256([]byte(input.HTML))
	hash := hex.EncodeToString(digest[:])
	images := []snapshotImage{}
	seen := map[string]bool{}
	size := int64(len(input.HTML))
	for _, raw := range input.Images {
		if !imageHashPattern.MatchString(raw.Hash) {
			return problem(400, "图片标识无效")
		}
		// 标识来自图片内容哈希，旧版扩展会把不同地址的同一张图重复上传，保留第一份即可。
		if seen[raw.Hash] {
			continue
		}
		seen[raw.Hash] = true
		encoded := raw.Data
		if strings.HasPrefix(encoded, "data:") {
			_, encoded, _ = strings.Cut(encoded, ",")
		}
		if len(encoded) > 14<<20 {
			return problem(413, "每张图片最大 10 MiB")
		}
		content, err := base64.StdEncoding.DecodeString(strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, encoded))
		if err != nil || len(content) == 0 || len(content) > 10<<20 {
			return problem(400, "图片 Base64 无效或过大")
		}
		mime, ok := snapshotImageMIME(content, raw.Type)
		if !ok {
			return problem(400, "仅支持可识别的图片或有效的 SVG")
		}
		size += int64(len(content))
		images = append(images, snapshotImage{raw.Hash, "blobs/" + auth.ID(), mime, content})
	}
	keys := []string{}
	committed := false
	defer func() {
		if !committed {
			s.removeObjects(keys)
		}
	}()
	sid, key := auth.ID(), "blobs/"+auth.ID()
	var result object
	duplicate := false
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		bookmark, err := one(r, tx, "SELECT b.*,COALESCE(b.snapshot_retention_count,p.snapshot_retention_count,5) AS retention FROM bookmarks b LEFT JOIN user_preferences p ON p.user_id=b.user_id WHERE b.id=? AND b.user_id=? AND b.deleted_at IS NULL", id(r), userID(r))
		if err != nil {
			return err
		}
		latest, err := one(r, tx, "SELECT content_hash FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=? ORDER BY version DESC LIMIT 1", id(r), userID(r))
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if str(latest["content_hash"]) == hash && !input.Force {
			duplicate = true
			return nil
		}
		retention := number(bookmark["retention"])
		if retention >= 1 && permit(r, "bookmarks.update") != nil {
			var count int64
			if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=?", id(r), userID(r)).Scan(&count); err != nil {
				return err
			}
			// 新增快照不能借自动保留策略删除已有版本。
			if count >= retention {
				return permit(r, "bookmarks.update")
			}
		}
		var used int64
		if err = tx.QueryRowContext(r.Context(), storageUsedQuery).Scan(&used); err != nil {
			return err
		}
		if s.config.StorageLimit > 0 && size > s.config.StorageLimit-used {
			return problem(413, "存储配额不足")
		}
		var version int64
		if err = tx.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(version),0)+1 FROM bookmark_snapshots WHERE bookmark_id=?", id(r)).Scan(&version); err != nil {
			return err
		}
		for _, image := range images {
			if err = s.writeObject(image.key, image.content); err != nil {
				return err
			}
			keys = append(keys, image.key)
		}
		if err = s.writeObject(key, []byte(input.HTML)); err != nil {
			return err
		}
		keys = append(keys, key)
		stamp := now()
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO bookmark_snapshots(id,bookmark_id,user_id,version,is_latest,content_hash,r2_key,r2_bucket,file_size,mime_type,snapshot_url,snapshot_title,snapshot_status,created_at,updated_at) VALUES(?,?,?,?,1,?,?,'local',?,'text/html',?,?,'completed',?,?)`, sid, id(r), userID(r), version, hash, key, size, input.URL, input.Title, stamp, stamp); err != nil {
			return err
		}
		for _, image := range images {
			if _, err = tx.ExecContext(r.Context(), "INSERT INTO snapshot_images(snapshot_id,image_hash,r2_key,mime_type) VALUES(?,?,?,?)", sid, image.hash, image.key, image.mime); err != nil {
				return err
			}
		}
		if retention >= 1 {
			if _, err = tx.ExecContext(r.Context(), "DELETE FROM bookmark_snapshots WHERE id IN (SELECT id FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=? ORDER BY version DESC LIMIT -1 OFFSET ?)", id(r), userID(r), retention); err != nil {
				return err
			}
		}
		if err = reconcileSnapshots(r, tx, id(r), userID(r)); err != nil {
			return err
		}
		result = object{"id": sid, "version": version, "is_latest": true, "file_size": size, "content_hash": hash, "snapshot_title": input.Title, "created_at": stamp}
		return nil
	})
	if err != nil {
		return err
	}
	committed = true
	s.drainGarbage(r.Context())
	if duplicate {
		return success(w, object{"message": "内容未变化", "is_duplicate": true})
	}
	uploads := make([]imageToHost, 0, len(images))
	for _, image := range images {
		uploads = append(uploads, imageToHost{image.key, image.mime, image.content})
	}
	s.hostImages(r, "snapshot", uploads)
	out := s.snapshotResponse(userID(r), id(r), result)
	out["image_count"] = len(images)
	return success(w, object{"snapshot": out, "message": "快照已保存"})
}
func (s *Server) viewSnapshot(w http.ResponseWriter, r *http.Request) error {
	uid := ""
	imageExpiry := stringInt(time.Now().Add(24 * time.Hour).Unix())
	sid := chi.URLParam(r, "snapshotId")
	if strings.HasSuffix(r.URL.Path, "/view") {
		q := r.URL.Query()
		uid = q.Get("u")
		exp, err := strconv.ParseInt(q.Get("exp"), 10, 64)
		expected := s.signature(uid + ":" + sid + ":" + q.Get("exp") + ":view")
		if err != nil || uid == "" || exp <= time.Now().Unix() || q.Get("a") != "view" || !hmac.Equal([]byte(expected), []byte(q.Get("sig"))) {
			return problem(401, "快照签名无效或已过期")
		}
		imageExpiry = q.Get("exp")
	} else {
		if err := permit(r, "bookmarks.read"); err != nil {
			return err
		}
		uid = userID(r)
	}
	row, err := one(r, s.db, "SELECT s.* FROM bookmark_snapshots s JOIN bookmarks b ON b.id=s.bookmark_id AND b.user_id=s.user_id WHERE s.id=? AND s.bookmark_id=? AND s.user_id=? AND b.deleted_at IS NULL", sid, id(r), uid)
	if err != nil {
		return err
	}
	root, err := s.objectRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.Open(str(row["r2_key"]))
	if errors.Is(err, os.ErrNotExist) {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, 50<<20+1))
	if err != nil {
		return err
	}
	if len(content) > 50<<20 {
		return problem(500, "快照文件过大")
	}
	images, err := all(r, s.db, "SELECT image_hash FROM snapshot_images WHERE snapshot_id=?", sid)
	if err != nil {
		return err
	}
	html, err := s.rewriteSnapshotHTML(content, images, uid, id(r), sid, stringInt(number(row["version"])), imageExpiry)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", snapshotCSP)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	_, err = io.WriteString(w, html)
	return err
}
func (s *Server) snapshotImage(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	hash, uid, bid := chi.URLParam(r, "hash"), q.Get("u"), q.Get("b")
	sid, version, expiry := q.Get("s"), q.Get("v"), q.Get("exp")
	exp, err := strconv.ParseInt(expiry, 10, 64)
	expected := s.signature("snapshot-image:" + hash + ":" + uid + ":" + bid + ":" + sid + ":" + version + ":" + expiry)
	if err != nil || exp <= time.Now().Unix() || !imageHashPattern.MatchString(hash) || uid == "" || bid == "" || sid == "" || version == "" || !hmac.Equal([]byte(expected), []byte(q.Get("sig"))) {
		return problem(401, "图片签名无效或已过期")
	}
	row, err := one(r, s.db, `SELECT i.r2_key,i.mime_type FROM snapshot_images i JOIN bookmark_snapshots s ON s.id=i.snapshot_id JOIN bookmarks b ON b.id=s.bookmark_id AND b.user_id=s.user_id WHERE i.image_hash=? AND s.user_id=? AND s.bookmark_id=? AND s.id=? AND s.version=? AND b.deleted_at IS NULL`, hash, uid, bid, sid, version)
	if err != nil {
		return err
	}
	return s.serveObject(w, r, str(row["r2_key"]), str(row["mime_type"]))
}
func (s *Server) bookmarkImage(w http.ResponseWriter, r *http.Request) error {
	hash := chi.URLParam(r, "hash")
	q := r.URL.Query()
	uid, bid, scope, expiry := q.Get("u"), q.Get("b"), q.Get("scope"), q.Get("exp")
	exp, err := strconv.ParseInt(expiry, 10, 64)
	expected := s.signature("bookmark-image:" + hash + ":" + uid + ":" + bid + ":" + scope + ":" + expiry)
	if err != nil || exp <= time.Now().Unix() || !imageHashPattern.MatchString(hash) || uid == "" || bid == "" || (scope != "owner" && scope != "public") || !hmac.Equal([]byte(expected), []byte(q.Get("sig"))) {
		return problem(401, "图片签名无效或已过期")
	}
	// 签名不能替代归属检查；撤销分享、删除书签和伪造图片引用均在这里拦截。
	row, err := one(r, s.db, `SELECT i.r2_key,i.mime_type FROM bookmark_images i JOIN bookmarks b ON b.id=i.bookmark_id AND b.user_id=i.user_id JOIN users u ON u.id=b.user_id WHERE (i.image_hash=? OR i.r2_key=?) AND i.user_id=? AND i.bookmark_id=? AND b.deleted_at IS NULL AND (?='owner' OR (b.is_public=1 AND u.public_share_enabled=1)) LIMIT 1`, hash, "images/"+hash, uid, bid, scope)
	if err != nil {
		return err
	}
	return s.serveObject(w, r, str(row["r2_key"]), str(row["mime_type"]))
}
func (s *Server) serveObject(w http.ResponseWriter, r *http.Request, key, mime string) error {
	return s.serveObjectCache(w, r, key, mime, "private, no-store")
}
func (s *Server) serveObjectCache(w http.ResponseWriter, r *http.Request, key, mime, cacheControl string) error {
	var address, savedConfig, cipher string
	err := s.db.QueryRowContext(r.Context(), "SELECT url,config,ciphertext FROM image_host_objects WHERE r2_key=?", key).Scan(&address, &savedConfig, &cipher)
	if err == nil {
		content, actualMIME, err := s.fetchStoredImage(r.Context(), address, savedConfig, cipher)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", actualMIME)
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'self'")
		w.Header().Set("Cache-Control", cacheControl)
		w.Header().Set("Referrer-Policy", "no-referrer")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(content))
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	root, err := s.objectRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.Open(key)
	if errors.Is(err, os.ErrNotExist) {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	if !stat.Mode().IsRegular() {
		return sql.ErrNoRows
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'self'")
	w.Header().Set("Cache-Control", cacheControl)
	http.ServeContent(w, r, "", stat.ModTime(), f)
	return nil
}
func (s *Server) deleteSnapshot(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if err := affected(tx.ExecContext(r.Context(), "DELETE FROM bookmark_snapshots WHERE id=? AND bookmark_id=? AND user_id=?", chi.URLParam(r, "snapshotId"), id(r), userID(r))); err != nil {
			return err
		}
		return reconcileSnapshots(r, tx, id(r), userID(r))
	})
	if err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"message": "快照已删除"})
}
func (s *Server) cleanupSnapshots(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	var input struct {
		Keep   *int `json:"keep_count"`
		Days   *int `json:"older_than_days"`
		Verify bool `json:"verify_and_fix"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if (input.Keep != nil && (*input.Keep < 0 || *input.Keep > 10000)) || (input.Days != nil && (*input.Days < 1 || *input.Days > 36500)) {
		return problem(400, "清理参数无效")
	}
	if input.Keep == nil && input.Days == nil && !input.Verify {
		return problem(400, "请选择清理方式")
	}
	deleted := 0
	var freed int64
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM bookmarks WHERE id=? AND user_id=?", id(r), userID(r)); err != nil {
			return err
		}
		rows, err := all(r, tx, "SELECT id,r2_key,file_size,created_at FROM bookmark_snapshots WHERE bookmark_id=? AND user_id=? ORDER BY version DESC", id(r), userID(r))
		if err != nil {
			return err
		}
		root, err := s.objectRoot()
		if err != nil {
			return err
		}
		defer root.Close()
		for i, row := range rows {
			remove := false
			if input.Keep != nil && i >= *input.Keep {
				remove = true
			}
			if input.Days != nil {
				stamp, err := time.Parse(time.RFC3339Nano, str(row["created_at"]))
				if err == nil && stamp.Before(time.Now().AddDate(0, 0, -*input.Days)) {
					remove = true
				}
			}
			if input.Verify {
				_, err := root.Stat(str(row["r2_key"]))
				if errors.Is(err, os.ErrNotExist) {
					remove = true
				} else if err != nil {
					return fmt.Errorf("检查快照: %w", err)
				}
			}
			if remove {
				if _, err = tx.ExecContext(r.Context(), "DELETE FROM bookmark_snapshots WHERE id=? AND user_id=?", row["id"], userID(r)); err != nil {
					return err
				}
				deleted++
				freed += number(row["file_size"])
			}
		}
		return reconcileSnapshots(r, tx, id(r), userID(r))
	})
	if err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"deleted_count": deleted, "freed_space": freed, "message": "清理完成"})
}
