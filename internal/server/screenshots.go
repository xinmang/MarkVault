package server

import (
	"bytes"
	"crypto/hmac"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
	"markvault/internal/database"
)

// 网站截图：浏览器扩展把帖子正文与图片渲染成的图文卡片，每个书签只保留最新一张。

const screenshotPrefix = "/api/bookmark-screenshots/"
const maxScreenshotBytes = 8 << 20
const maxScreenshotWidth = 8192
const maxScreenshotHeight = 32768

type screenshotInput struct {
	Image     string `json:"image"`
	SourceURL string `json:"source_url"`
}

// decodeImageData 接受 data URL 或纯 Base64，忽略换行等空白。
func decodeImageData(raw string) ([]byte, error) {
	encoded := raw
	if strings.HasPrefix(encoded, "data:") {
		header, body, ok := strings.Cut(encoded, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return nil, errors.New("仅支持 Base64 编码的 data URL")
		}
		encoded = body
	}
	return base64.StdEncoding.DecodeString(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, encoded))
}

// screenshotImageInfo 只认 PNG、JPEG、WebP，并从文件头读取真实像素尺寸，不信任客户端声明。
func screenshotImageInfo(content []byte) (string, int, int, bool) {
	switch {
	case bytes.HasPrefix(content, []byte("\x89PNG\r\n\x1a\n")):
		cfg, err := png.DecodeConfig(bytes.NewReader(content))
		if err != nil {
			return "", 0, 0, false
		}
		return "image/png", cfg.Width, cfg.Height, true
	case bytes.HasPrefix(content, []byte{0xff, 0xd8, 0xff}):
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(content))
		if err != nil {
			return "", 0, 0, false
		}
		return "image/jpeg", cfg.Width, cfg.Height, true
	case len(content) >= 16 && string(content[0:4]) == "RIFF" && string(content[8:12]) == "WEBP":
		width, height, ok := webpSize(content)
		return "image/webp", width, height, ok
	}
	return "", 0, 0, false
}

// webpSize 读取首个数据块中的画布尺寸：扩展格式 VP8X、有损 VP8、无损 VP8L。
func webpSize(b []byte) (int, int, bool) {
	width, height := 0, 0
	switch string(b[12:16]) {
	case "VP8X":
		if len(b) < 30 {
			return 0, 0, false
		}
		width = 1 + (int(b[24]) | int(b[25])<<8 | int(b[26])<<16)
		height = 1 + (int(b[27]) | int(b[28])<<8 | int(b[29])<<16)
	case "VP8 ":
		if len(b) < 30 || b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, false
		}
		width = int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff)
		height = int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
	case "VP8L":
		if len(b) < 25 || b[20] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		width = int(bits&0x3fff) + 1
		height = int(bits>>14&0x3fff) + 1
	default:
		return 0, 0, false
	}
	return width, height, width > 0 && height > 0
}

// screenshotURL 的有效期按整点分桶：同一小时内地址不变，浏览器可以复用缓存。
func (s *Server) screenshotURL(uid, bid, sid, scope string) string {
	exp := stringInt((time.Now().Unix()/3600 + 2) * 3600)
	q := url.Values{"u": {uid}, "b": {bid}, "scope": {scope}, "exp": {exp}}
	q.Set("sig", s.signature("bookmark-screenshot:"+sid+":"+uid+":"+bid+":"+scope+":"+exp))
	return screenshotPrefix + url.PathEscape(sid) + "?" + q.Encode()
}

func (s *Server) screenshotResponse(uid, bid, scope string, row object) object {
	result := copyFields(row, "id", "width", "height", "file_size", "mime_type", "created_at")
	result["url"] = s.screenshotURL(uid, bid, str(row["id"]), scope)
	return result
}

// attachScreenshots 为书签补充 screenshot 字段（没有截图时为 null）；签名链接不进入导出数据。
func (s *Server) attachScreenshots(r *http.Request, db database.Queryer, uid string, rows []object, scope string) error {
	if len(rows) == 0 {
		return nil
	}
	args := []any{uid}
	byID := map[string]object{}
	for _, row := range rows {
		row["screenshot"] = nil
		byID[str(row["id"])] = row
		args = append(args, row["id"])
	}
	shots, err := all(r, db, "SELECT id,bookmark_id,width,height,file_size,mime_type,created_at FROM bookmark_screenshots WHERE user_id=? AND bookmark_id IN ("+placeholders(len(rows))+")", args...)
	if err != nil {
		return err
	}
	for _, shot := range shots {
		bid := str(shot["bookmark_id"])
		if row := byID[bid]; row != nil {
			row["screenshot"] = s.screenshotResponse(uid, bid, scope, shot)
		}
	}
	return nil
}

func (s *Server) uploadScreenshot(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.create"); err != nil {
		return err
	}
	var input screenshotInput
	if err := decodeLimit(w, r, &input, 12<<20); err != nil {
		return err
	}
	if input.SourceURL != "" && !validURL(input.SourceURL) {
		return problem(400, "截图来源网址无效")
	}
	content, err := decodeImageData(input.Image)
	if err != nil || len(content) == 0 {
		return problem(400, "截图图片无效")
	}
	if len(content) > maxScreenshotBytes {
		return problem(413, "截图最大 8 MiB")
	}
	mime, width, height, ok := screenshotImageInfo(content)
	if !ok {
		return problem(400, "截图仅支持 PNG、JPEG 或 WebP 图片")
	}
	if width > maxScreenshotWidth || height > maxScreenshotHeight {
		return problem(400, "截图尺寸超过限制")
	}
	sid, key := auth.ID(), "blobs/"+auth.ID()
	written, committed := false, false
	defer func() {
		if written && !committed {
			s.removeObjects([]string{key})
		}
	}()
	var row object
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM bookmarks WHERE id=? AND user_id=? AND deleted_at IS NULL", id(r), userID(r)); err != nil {
			return err
		}
		existing, err := one(r, tx, "SELECT id,file_size FROM bookmark_screenshots WHERE bookmark_id=? AND user_id=?", id(r), userID(r))
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		// 新增截图只需创建权限；替换会删除已有截图，与快照一致要求修改权限。
		if existing != nil && permit(r, "bookmarks.update") != nil {
			return &httpError{403, "替换已有截图需要 API Key 具备 bookmarks.update 权限", "INSUFFICIENT_PERMISSIONS"}
		}
		var used int64
		if err = tx.QueryRowContext(r.Context(), storageUsedQuery).Scan(&used); err != nil {
			return err
		}
		if s.config.StorageLimit > 0 && int64(len(content)) > s.config.StorageLimit-used+number(existing["file_size"]) {
			return problem(413, "存储配额不足")
		}
		if err = s.writeObject(key, content); err != nil {
			return err
		}
		written = true
		if existing != nil {
			if _, err = tx.ExecContext(r.Context(), "DELETE FROM bookmark_screenshots WHERE id=?", existing["id"]); err != nil {
				return err
			}
		}
		stamp := now()
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO bookmark_screenshots(id,bookmark_id,user_id,r2_key,mime_type,width,height,file_size,source_url,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", sid, id(r), userID(r), key, mime, width, height, len(content), input.SourceURL, stamp); err != nil {
			return err
		}
		row = object{"id": sid, "width": width, "height": height, "file_size": len(content), "mime_type": mime, "created_at": stamp}
		return nil
	})
	if err != nil {
		return err
	}
	committed = true
	s.hostImages(r, "screenshot", []imageToHost{{key, mime, content}})
	s.drainGarbage(r.Context())
	return success(w, object{"screenshot": s.screenshotResponse(userID(r), id(r), "owner", row), "message": "截图已保存"})
}

func (s *Server) deleteScreenshot(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "DELETE FROM bookmark_screenshots WHERE bookmark_id=? AND user_id=?", id(r), userID(r))); err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"message": "截图已删除"})
}

func (s *Server) screenshotImage(w http.ResponseWriter, r *http.Request) error {
	sid := chi.URLParam(r, "screenshotId")
	q := r.URL.Query()
	uid, bid, scope, expiry := q.Get("u"), q.Get("b"), q.Get("scope"), q.Get("exp")
	exp, err := strconv.ParseInt(expiry, 10, 64)
	expected := s.signature("bookmark-screenshot:" + sid + ":" + uid + ":" + bid + ":" + scope + ":" + expiry)
	if err != nil || exp <= time.Now().Unix() || !imageHashPattern.MatchString(sid) || uid == "" || bid == "" || (scope != "owner" && scope != "public") || !hmac.Equal([]byte(expected), []byte(q.Get("sig"))) {
		return problem(401, "图片签名无效或已过期")
	}
	// 签名不能替代归属检查：删除书签、撤销公开或关闭分享后立即失效。
	row, err := one(r, s.db, `SELECT sc.r2_key,sc.mime_type FROM bookmark_screenshots sc JOIN bookmarks b ON b.id=sc.bookmark_id AND b.user_id=sc.user_id JOIN users u ON u.id=b.user_id WHERE sc.id=? AND sc.user_id=? AND sc.bookmark_id=? AND b.deleted_at IS NULL AND (?='owner' OR (b.is_public=1 AND u.public_share_enabled=1))`, sid, uid, bid, scope)
	if err != nil {
		return err
	}
	// 截图内容不可变（替换会生成新 ID），签名链接在一小时内不变，允许浏览器私有缓存。
	return s.serveObjectCache(w, r, str(row["r2_key"]), str(row["mime_type"]), "private, max-age=3600")
}
