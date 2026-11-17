package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"markvault/internal/auth"
)

var preferenceEnums = map[string]string{
	"theme": "light dark system", "view_mode": "list card minimal title collectible gallery timeline domains focus", "density": "compact normal comfortable", "tag_layout": "grid masonry cloud bars", "tag_sort_by": "usage name clicks", "sort_by": "created updated pinned popular", "default_bookmark_icon": "gradient-glow pulse-breath orbital-spinner bookmark",
	"experimental_tag_heat_style": "fill progress liquid rarity", "experimental_tag_heat_effect": "auto foil diamond sparkle prism galaxy none", "experimental_url_privacy_effect": "blur mosaic mask", "experimental_hover_card_theme": "creature duelist arcane", "experimental_hover_card_effect": "auto foil prism galaxy none",
	"motion_intensity": "subtle standard lively", "motion_card_hover": "none lift tilt glow", "motion_list_entrance": "none fade rise scale",
	"ocean_background_scope": "browser account", "ocean_background": "off sharks dolphins mixed",
}
var preferenceRanges = map[string][2]int{
	"page_size": {1, 200}, "bookmark_initial_count": {1, 200}, "bookmark_load_more_expiry_minutes": {0, 1440}, "search_auto_clear_seconds": {5, 120}, "tag_selection_auto_clear_seconds": {10, 300}, "snapshot_retention_count": {-1, 100}, "snapshot_auto_cleanup_days": {0, 365}, "experimental_tag_heat_intensity": {20, 100}, "experimental_url_privacy_strength": {1, 12}, "experimental_hover_card_intensity": {20, 100}, "experimental_hover_card_size": {75, 125}, "experimental_hover_card_delay": {100, 1500}, "experimental_hover_card_advanced_clicks": {1, 100000}, "experimental_hover_card_collector_clicks": {1, 100000}, "experimental_hover_card_secret_clicks": {1, 100000}, "motion_speed": {50, 200},
}
var preferenceBools = strings.Fields("show_tag_icons enable_search_auto_clear enable_tag_selection_auto_clear snapshot_auto_create snapshot_auto_dedupe experimental_vibehub_theme_enabled experimental_uiux_pro_theme_enabled experimental_ascii_theme_enabled experimental_liquid_glass_theme_enabled experimental_tag_heat_enabled experimental_url_privacy_enabled experimental_hover_card_enabled experimental_hover_card_shuffle_enabled motion_enabled motion_button_feedback motion_tag_linkage motion_page_transition")
var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func contains(values []string, v string) bool {
	for _, item := range values {
		if item == v {
			return true
		}
	}
	return false
}
func (s *Server) preferences(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "user.preferences.read"); err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM user_preferences WHERE user_id=?", userID(r))
	if err != nil {
		return err
	}
	bools(row, preferenceBools...)
	return success(w, object{"preferences": row})
}
func (s *Server) updatePreferences(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if len(body) == 0 {
		return problem(400, "没有可更新的偏好")
	}
	for key, value := range body {
		valid := false
		if options, ok := preferenceEnums[key]; ok {
			v, isString := value.(string)
			valid = isString && contains(strings.Fields(options), v)
		} else if bounds, ok := preferenceRanges[key]; ok {
			v, isNumber := value.(float64)
			valid = isNumber && v == math.Trunc(v) && v >= float64(bounds[0]) && v <= float64(bounds[1])
		} else if contains(preferenceBools, key) {
			_, valid = value.(bool)
		} else if key == "experimental_tag_heat_color" || key == "experimental_hover_card_accent_color" {
			v, isString := value.(string)
			valid = isString && hexColor.MatchString(v)
		}
		if !valid {
			return problem(400, "偏好字段或值无效: "+key)
		}
	}
	// 互斥的界面主题只保留一个：打开其中一项时，未在本次请求中出现的同组开关一并关闭。
	for key, value := range body {
		if value != true {
			continue
		}
		for _, other := range s.plugins.Policy.ExclusivePreferences(key) {
			if current, present := body[other]; !present {
				body[other] = false
			} else if current == true {
				return problem(400, "界面主题只能启用一个")
			}
		}
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		row, err := one(r, tx, "SELECT * FROM user_preferences WHERE user_id=?", userID(r))
		if err != nil {
			return err
		}
		for k, v := range body {
			row[k] = v
		}
		if !(number(row["experimental_hover_card_advanced_clicks"]) < number(row["experimental_hover_card_collector_clicks"]) && number(row["experimental_hover_card_collector_clicks"]) < number(row["experimental_hover_card_secret_clicks"])) {
			return problem(400, "悬浮卡片点击阈值必须递增")
		}
		body["updated_at"] = now()
		_, err = updateFields(r, tx, "user_preferences", body, "user_id=?", userID(r))
		return err
	})
	if err != nil {
		return err
	}
	return s.preferences(w, r)
}

var permissionTemplates = map[string][]string{
	"READ_ONLY": {"bookmarks.read", "tags.read", "user.read"},
	"BASIC":     {"bookmarks.create", "bookmarks.read", "tags.create", "tags.read", "tags.assign", "user.read"},
	"FULL":      {"bookmarks.*", "tags.*", "tab_groups.*", "ai.suggest", "user.read"},
}

func validPermission(v string) bool {
	if v == "user.read" || v == "user.preferences.read" || v == "ai.suggest" || v == "tags.assign" {
		return true
	}
	parts := strings.Split(v, ".")
	return len(parts) == 2 && contains([]string{"bookmarks", "tags", "tab_groups"}, parts[0]) && contains([]string{"*", "read", "create", "update", "delete"}, parts[1])
}
func keyResponse(row object) object {
	delete(row, "key_hash")
	// 历史版本曾保存密文，响应始终只展示前缀和元信息。
	delete(row, "key_encrypted")
	var permissions []string
	_ = json.Unmarshal([]byte(str(row["permissions"])), &permissions)
	if permissions == nil {
		permissions = []string{}
	}
	row["permissions"] = permissions
	return row
}
func (s *Server) listKeys(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	rows, err := all(r, s.db, "SELECT * FROM api_keys WHERE user_id=? ORDER BY created_at DESC", userID(r))
	if err != nil {
		return err
	}
	used := 0
	for _, row := range rows {
		keyResponse(row)
		if str(row["status"]) == "active" {
			used++
		}
	}
	return success(w, object{"keys": rows, "quota": object{"used": used, "limit": 20}})
}
func (s *Server) getKey(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM api_keys WHERE id=? AND user_id=?", id(r), userID(r))
	if err != nil {
		return err
	}
	var total int
	if err = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM api_key_logs WHERE api_key_id=? AND user_id=?", id(r), userID(r)).Scan(&total); err != nil {
		return err
	}
	row["stats"] = object{"total_requests": total, "last_used_at": row["last_used_at"], "last_used_ip": row["last_used_ip"]}
	return success(w, keyResponse(row))
}

func keyFields(body object, creating bool) (object, error) {
	if body == nil {
		return nil, problem(400, "缺少 API Key 内容")
	}
	fields := object{}
	for k, v := range body {
		switch k {
		case "name":
			text, ok := v.(string)
			if !ok || strings.TrimSpace(text) == "" || len(text) > 200 {
				return nil, problem(400, "请输入有效的名称")
			}
			fields[k] = strings.TrimSpace(text)
		case "description":
			if v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 1000 {
					return nil, problem(400, "描述格式无效")
				}
			}
			fields[k] = v
		case "expires_at":
			if v != nil {
				text, ok := v.(string)
				stamp, e := time.Parse(time.RFC3339, text)
				if !ok || e != nil || !stamp.After(time.Now()) {
					return nil, problem(400, "过期时间必须是将来的 RFC3339 时间")
				}
			}
			fields[k] = v
		case "permissions", "template":
		default:
			return nil, problem(400, "未知 API Key 字段: "+k)
		}
	}
	if creating && fields["name"] == nil {
		return nil, problem(400, "名称不能为空")
	}
	var permissions []string
	if template, ok := body["template"]; ok {
		values, exists := permissionTemplates[str(template)]
		if !exists {
			return nil, problem(400, "未知权限模板")
		}
		permissions = values
	} else if v, ok := body["permissions"]; ok {
		list, ok := v.([]any)
		if !ok {
			return nil, problem(400, "权限必须为数组")
		}
		permissions = []string{}
		for _, item := range list {
			p, ok := item.(string)
			if !ok || !validPermission(p) {
				return nil, problem(400, "未知权限")
			}
			permissions = append(permissions, p)
		}
	} else if creating {
		permissions = permissionTemplates["BASIC"]
	}
	if permissions != nil {
		if len(permissions) == 0 || len(permissions) > 30 {
			return nil, problem(400, "需提供 1–30 个有效权限")
		}
		b, _ := json.Marshal(permissions)
		fields["permissions"] = string(b)
	}
	return fields, nil
}
func (s *Server) createKey(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, err := keyFields(body, true)
	if err != nil {
		return err
	}
	// 32 字节随机数 → 64 位十六进制（256 bit），服务端只按前缀和哈希识别 Key。
	raw, err := auth.RandomToken(32)
	if err != nil {
		return err
	}
	key := "mvk_live_" + auth.HashAPIKey(raw)
	kid := auth.ID()
	stamp := now()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM api_keys WHERE user_id=? AND status='active'", userID(r)).Scan(&count); err != nil {
			return err
		}
		if count >= 20 {
			return problem(400, "最多允许 20 个有效 API Key")
		}
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO api_keys(id,user_id,key_hash,key_prefix,name,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", kid, userID(r), auth.HashAPIKey(key), key[:13], fields["name"], fields["permissions"], stamp, stamp); err != nil {
			return err
		}
		_, err := updateFields(r, tx, "api_keys", fields, "id=? AND user_id=?", kid, userID(r))
		return err
	})
	if err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM api_keys WHERE id=? AND user_id=?", kid, userID(r))
	if err != nil {
		return err
	}
	keyResponse(row)
	row["key"] = key
	w.Header().Set("Cache-Control", "no-store")
	return created(w, row)
}
func (s *Server) updateKey(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, err := keyFields(body, false)
	if err != nil {
		return err
	}
	fields["updated_at"] = now()
	if err := affected(updateFields(r, s.db, "api_keys", fields, "id=? AND user_id=?", id(r), userID(r))); err != nil {
		return err
	}
	return s.getKey(w, r)
}
func (s *Server) deleteKey(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	q := "UPDATE api_keys SET status='revoked',updated_at=? WHERE id=? AND user_id=?"
	args := []any{now(), id(r), userID(r)}
	if r.URL.Query().Get("hard") == "true" {
		q = "DELETE FROM api_keys WHERE id=? AND user_id=?"
		args = []any{id(r), userID(r)}
	}
	if err := affected(s.db.ExecContext(r.Context(), q, args...)); err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) keyLogs(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if _, err := one(r, s.db, "SELECT id FROM api_keys WHERE id=? AND user_id=?", id(r), userID(r)); err != nil {
		return err
	}
	limit := 10
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if _, err := fmt.Sscan(raw, &limit); err != nil || limit < 1 || limit > 100 {
			return problem(400, "limit 必须在 1 到 100 之间")
		}
	}
	rows, err := all(r, s.db, "SELECT * FROM api_key_logs WHERE api_key_id=? AND user_id=? ORDER BY id DESC LIMIT ?", id(r), userID(r), limit)
	if err != nil {
		return err
	}
	return success(w, object{"logs": rows, "limit": limit})
}
