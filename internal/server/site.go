package server

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// 站点品牌信息是全局单例数据：不写入 user_preferences，也不落到某个账号的浏览器存储。
const (
	defaultSiteName         = "MarkVault"
	maxSiteNameRunes        = 80
	maxSiteDescriptionRunes = 300
	maxSiteImageURLBytes    = 2048
	maxSiteImageBytes       = 256 * 1024
)

// 站点图片只接受位图的 data URI，明确不接受 SVG、HTML 及其他可执行内容。
var siteImageDataHeaders = []string{
	"data:image/png;base64",
	"data:image/jpeg;base64",
	"data:image/gif;base64",
	"data:image/webp;base64",
}

// defaultSite 返回恢复默认后的站点品牌信息，与迁移中的初始值保持一致。
func defaultSite() object {
	return object{
		"site_name":        defaultSiteName,
		"site_description": "",
		"site_logo":        "",
		"site_favicon":     "",
	}
}

// validSiteImage 校验站点图片：完整的 HTTP(S) 地址，或体积受限的位图 data URI。
// 服务端从不抓取远程图片，仅把它当作 <img>/favicon 资源交给浏览器。
func validSiteImage(value string) bool {
	if value == "" {
		return true
	}
	if strings.HasPrefix(value, "data:") {
		// 先按编码后长度粗筛，避免对超大文本做解码。
		if len(value) > 64+((maxSiteImageBytes+2)/3)*4 {
			return false
		}
		header, encoded, found := strings.Cut(value, ",")
		if !found || !contains(siteImageDataHeaders, header) {
			return false
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || len(raw) == 0 || len(raw) > maxSiteImageBytes {
			return false
		}
		// 声明类型必须与真实内容一致，防止把非图片内容伪装成位图。
		return "data:"+http.DetectContentType(raw)+";base64" == header
	}
	if len(value) > maxSiteImageURLBytes {
		return false
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "" && parsed.User == nil
}

// siteRow 读取单例设置。
// 单例记录缺失时（例如已被手工删除）回退到默认值；表或迁移缺失属于异常状态，
// 不做回退而是直接返回错误，避免把数据库故障伪装成默认配置。
func (s *Server) siteRow(r *http.Request) (object, error) {
	row, err := one(r, s.db, "SELECT site_name,site_description,site_logo,site_favicon,updated_at FROM site_settings WHERE id=1")
	if errors.Is(err, sql.ErrNoRows) {
		row = defaultSite()
		row["updated_at"] = nil
		return row, nil
	}
	if err != nil {
		return nil, err
	}
	return row, nil
}

// publicSite 输出可公开的品牌信息，空名称一律回落到默认名称。
func publicSite(row object) object {
	name := strings.TrimSpace(str(row["site_name"]))
	if name == "" {
		name = defaultSiteName
	}
	return object{
		"site_name":        name,
		"site_description": strings.TrimSpace(str(row["site_description"])),
		"site_logo":        str(row["site_logo"]),
		"site_favicon":     str(row["site_favicon"]),
		"updated_at":       row["updated_at"],
	}
}

// canManageSite 使用数据库中的管理员角色判断权限，与插件管理保持一致。
func (s *Server) canManageSite(r *http.Request) (bool, error) {
	uid := userID(r)
	if uid == "" {
		return false, nil
	}
	var role string
	err := s.db.QueryRowContext(r.Context(), "SELECT COALESCE(role,'user') FROM users WHERE id=?", uid).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return role == "admin", nil
}

func (s *Server) requireSiteAdmin(r *http.Request) error {
	allowed, err := s.canManageSite(r)
	if err != nil {
		return err
	}
	if !allowed {
		return problem(403, "只有管理员可以修改全站设置")
	}
	return nil
}

// publicSiteHandler 处理匿名 GET /api/v1/site，供登录页与分享页读取品牌信息。
func (s *Server) publicSiteHandler(w http.ResponseWriter, r *http.Request) error {
	row, err := s.siteRow(r)
	if err != nil {
		return err
	}
	return success(w, object{"site": publicSite(row)})
}

// siteSettingsHandler 处理 JWT 下的站点设置读写，PUT 必须通过管理员校验，API Key 不可修改。
func (s *Server) siteSettingsHandler(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if r.Method == "PUT" {
		if err := s.requireSiteAdmin(r); err != nil {
			return err
		}
		if err := s.updateSiteSettings(w, r); err != nil {
			return err
		}
	}
	row, err := s.siteRow(r)
	if err != nil {
		return err
	}
	allowed, err := s.canManageSite(r)
	if err != nil {
		return err
	}
	return success(w, object{"site": publicSite(row), "can_edit": allowed, "defaults": defaultSite()})
}

// updateSiteSettings 校验并保存站点设置，reset_defaults 显式恢复默认值。
func (s *Server) updateSiteSettings(w http.ResponseWriter, r *http.Request) error {
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields := object{}
	reset := false
	for key, value := range body {
		switch key {
		case "reset_defaults":
			b, ok := value.(bool)
			if !ok || !b {
				return problem(400, "reset_defaults 只能为 true")
			}
			reset = true
		case "site_name":
			text, ok := value.(string)
			if !ok {
				return problem(400, "网站名称必须是字符串")
			}
			text = strings.TrimSpace(text)
			if n := utf8.RuneCountInString(text); n < 1 || n > maxSiteNameRunes {
				return problem(400, "网站名称需为 1–80 个字符")
			}
			fields[key] = text
		case "site_description":
			text, ok := value.(string)
			if !ok {
				return problem(400, "网站描述必须是字符串")
			}
			text = strings.TrimSpace(text)
			if utf8.RuneCountInString(text) > maxSiteDescriptionRunes {
				return problem(400, "网站描述最多 300 个字符")
			}
			fields[key] = text
		case "site_logo", "site_favicon":
			text, ok := value.(string)
			if !ok {
				return problem(400, "站点图片必须是字符串")
			}
			text = strings.TrimSpace(text)
			if !validSiteImage(text) {
				return problem(400, "站点图片需为 HTTP(S) 图片地址，或不超过 256 KiB 的 PNG/JPEG/GIF/WebP 上传文件")
			}
			fields[key] = text
		default:
			return problem(400, "未知站点设置字段: "+key)
		}
	}
	if reset {
		fields = defaultSite()
	} else if len(fields) == 0 {
		return problem(400, "没有可更新的站点设置")
	}
	fields["updated_at"] = now()
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		// 升级后遗留的空表也能自愈，避免首次保存失败。
		if _, err := tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO site_settings(id,site_name) VALUES(1,?)", defaultSiteName); err != nil {
			return err
		}
		_, err := updateFields(r, tx, "site_settings", fields, "id=1")
		return err
	})
	return err
}
