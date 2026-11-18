package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"markvault/internal/auth"
)

func queryBool(r *http.Request, name string, fallback bool) bool {
	value := r.URL.Query().Get(name)
	if value == "true" {
		return true
	}
	if value == "false" {
		return false
	}
	return fallback
}
func copyFields(source object, keys ...string) object {
	result := object{}
	for _, key := range keys {
		if value, ok := source[key]; ok {
			result[key] = value
		}
	}
	return result
}
func (s *Server) exportData(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	scope := r.URL.Query().Get("scope")
	includeDeleted := queryBool(r, "include_deleted", false)
	format := r.URL.Query().Get("format")
	if r.Method == "POST" {
		var body struct {
			Scope   string `json:"scope"`
			Format  string `json:"format"`
			Deleted bool   `json:"include_deleted"`
		}
		if err := decode(w, r, &body); err != nil {
			return err
		}
		scope, format, includeDeleted = body.Scope, body.Format, body.Deleted
	}
	if format != "" && format != "json" {
		return problem(400, "只支持 JSON 导出")
	}
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "bookmarks" && scope != "tab_groups" {
		return problem(400, "导出范围无效")
	}
	result := object{"version": "1.0.0", "format": "markvault", "exported_at": now(), "bookmarks": []object{}, "tags": []object{}, "tab_groups": []object{}}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if scope != "tab_groups" {
			filter := ""
			if !includeDeleted {
				filter = " AND deleted_at IS NULL"
			}
			bookmarks, err := all(r, tx, "SELECT * FROM bookmarks WHERE user_id=?"+filter+" ORDER BY created_at,id", userID(r))
			if err != nil {
				return err
			}
			// 分批装饰以控制 SQLite 参数数量。
			for start := 0; start < len(bookmarks); start += 500 {
				end := start + 500
				if end > len(bookmarks) {
					end = len(bookmarks)
				}
				if err = s.decorateBookmarkData(r, tx, bookmarks[start:end]); err != nil {
					return err
				}
			}
			// 备份包含全部备注，不做条数和长度截断。
			if err = s.attachNotes(r, tx, bookmarkNotes, bookmarks, 0, 0); err != nil {
				return err
			}
			exported := []object{}
			for _, row := range bookmarks {
				item := copyFields(row, "id", "title", "url", "description", "cover_image", "cover_image_id", "favicon", "is_pinned", "is_archived", "is_public", "created_at", "updated_at", "deleted_at", "has_snapshot", "latest_snapshot_at", "snapshot_count")
				names := []string{}
				if queryBool(r, "include_tags", true) {
					for _, tag := range row["tags"].([]object) {
						names = append(names, str(tag["name"]))
					}
				}
				item["tags"] = names
				item["notes"] = exportNotes(row)
				if queryBool(r, "include_stats", false) {
					item["click_count"] = row["click_count"]
					item["last_clicked_at"] = row["last_clicked_at"]
				}
				exported = append(exported, item)
			}
			result["bookmarks"] = exported
			if queryBool(r, "include_tags", true) {
				tags, err := all(r, tx, "SELECT id,name,color,icon,created_at,updated_at,deleted_at FROM tags WHERE user_id=?"+filter+" ORDER BY name,id", userID(r))
				if err != nil {
					return err
				}
				result["tags"] = tags
			}
		}
		if scope != "bookmarks" {
			filter := ""
			if !includeDeleted {
				filter = " AND is_deleted=0"
			}
			groups, err := all(r, tx, "SELECT * FROM tab_groups WHERE user_id=?"+filter+" ORDER BY position,id", userID(r))
			if err != nil {
				return err
			}
			for start := 0; start < len(groups); start += 500 {
				end := start + 500
				if end > len(groups) {
					end = len(groups)
				}
				if err = s.groups(r, tx, groups[start:end]); err != nil {
					return err
				}
			}
			if err = s.attachItemNotes(r, tx, groups, 0, 0); err != nil {
				return err
			}
			for _, g := range groups {
				delete(g, "user_id")
				bools(g, "is_folder", "is_deleted")
				for _, item := range g["items"].([]object) {
					item["notes"] = exportNotes(item)
					delete(item, "note_count")
				}
			}
			result["tab_groups"] = groups
		}
		if queryBool(r, "include_user", false) {
			user, err := one(r, tx, "SELECT id,username AS name,email,created_at FROM users WHERE id=?", userID(r))
			if err != nil {
				return err
			}
			result["user"] = user
		}
		return nil
	})
	if err != nil {
		return err
	}
	stats := object{"total_bookmarks": len(result["bookmarks"].([]object)), "total_tags": len(result["tags"].([]object)), "total_tab_groups": len(result["tab_groups"].([]object)), "pinned_bookmarks": 0}
	for _, b := range result["bookmarks"].([]object) {
		if boolean(b["is_pinned"]) {
			stats["pinned_bookmarks"] = stats["pinned_bookmarks"].(int) + 1
		}
	}
	if queryBool(r, "include_metadata", true) {
		result["metadata"] = object{"total_bookmarks": stats["total_bookmarks"], "total_tags": stats["total_tags"], "total_tab_groups": stats["total_tab_groups"], "export_format": "json", "source": "markvault"}
	}
	var encoded []byte
	if queryBool(r, "pretty_print", true) {
		encoded, err = json.MarshalIndent(result, "", "  ")
	} else {
		encoded, err = json.Marshal(result)
	}
	if err != nil {
		return err
	}
	filename := "markvault-" + scope + "-" + time.Now().UTC().Format("2006-01-02") + ".json"
	if r.Method == "POST" {
		return reply(w, 200, object{"stats": stats, "estimated_size": len(encoded), "format": "json", "estimated_filename": filename})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, err = w.Write(encoded)
	return err
}

type importFile struct {
	Format    string   `json:"format"`
	Version   string   `json:"version"`
	Bookmarks []object `json:"bookmarks"`
	Tags      []object `json:"tags"`
	Groups    []object `json:"tab_groups"`
}
type entityStats struct {
	Total    int `json:"total"`
	Created  int `json:"created"`
	Updated  int `json:"updated"`
	Skipped  int `json:"skipped"`
	Failed   int `json:"failed"`
	Reused   int `json:"reused"`
	Restored int `json:"restored"`
}

func importDate(v any, fallback string, preserve bool) string {
	if preserve {
		if parsed, err := time.Parse(time.RFC3339Nano, str(v)); err == nil {
			return parsed.UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	return fallback
}
func (s *Server) importData(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	// 导入在一个事务里完成，期间独占 SQLite 唯一的连接：限制频率并保证同一时间只有一个导入。
	if err := s.rate(r, w, "import:"+userID(r), 10, 3600); err != nil {
		return err
	}
	if !s.importBusy.CompareAndSwap(false, true) {
		w.Header().Set("Retry-After", "30")
		return problem(429, "已有导入任务正在进行，请稍后重试")
	}
	defer s.importBusy.Store(false)
	var input importFile
	if err := decodeLimit(w, r, &input, 25<<20); err != nil {
		return err
	}
	if (input.Format != "markvault" && input.Format != "tmarks") || input.Bookmarks == nil || input.Tags == nil {
		return problem(400, "需要包含 bookmarks 和 tags 数组的 MarkVault/TMarks JSON 文件")
	}
	if len(input.Bookmarks) > 20000 || len(input.Tags) > 5000 || len(input.Groups) > 5000 {
		return problem(400, "导入数量超出限制")
	}
	itemTotal := 0
	for _, g := range input.Groups {
		if items, ok := g["items"].([]any); ok {
			itemTotal += len(items)
		}
	}
	if itemTotal > 50000 {
		return problem(400, "标签页数量超过 50000")
	}
	bookmarksEnabled, groupsEnabled := queryBool(r, "import_bookmarks", true), queryBool(r, "import_tab_groups", true)
	if !bookmarksEnabled && !groupsEnabled {
		return problem(400, "至少选择一种导入内容")
	}
	preserve, includeDeleted, skip := queryBool(r, "preserve_timestamps", true), queryBool(r, "include_deleted", false), queryBool(r, "skip_duplicates", true)
	bs, ts, gs, is := &entityStats{}, &entityStats{}, &entityStats{}, &entityStats{}
	if bookmarksEnabled {
		bs.Total = len(input.Bookmarks)
		ts.Total = len(input.Tags)
	}
	if groupsEnabled {
		gs.Total = len(input.Groups)
		is.Total = itemTotal
	}
	issues := []object{}
	warnings := []string{}
	invalid := func(entity string, index int, err error) {
		if len(issues) < 100 {
			issues = append(issues, object{"entity": entity, "index": index, "error": err.Error(), "code": "VALIDATION_ERROR"})
		}
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		tagIDs := map[string]string{}
		ensureTag := func(name, color string) (string, error) {
			name = strings.TrimSpace(name)
			if name == "" || len(name) > 150 {
				return "", problem(400, "标签名无效")
			}
			key := strings.ToLower(name)
			if tid := tagIDs[key]; tid != "" {
				return tid, nil
			}
			row, err := one(r, tx, "SELECT id,deleted_at FROM tags WHERE user_id=? AND lower(name)=lower(?)", userID(r), name)
			if err == nil {
				tid := str(row["id"])
				tagIDs[key] = tid
				if row["deleted_at"] != nil {
					_, err = tx.ExecContext(r.Context(), "UPDATE tags SET deleted_at=NULL,updated_at=? WHERE id=?", now(), tid)
					ts.Restored++
				} else {
					ts.Reused++
				}
				return tid, err
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return "", err
			}
			if color == "" {
				color = "#3b82f6"
			}
			fields, err := tagFields(object{"name": name, "color": color}, true)
			if err != nil {
				return "", err
			}
			tid := auth.ID()
			_, err = tx.ExecContext(r.Context(), "INSERT INTO tags(id,user_id,name,color,created_at,updated_at) VALUES(?,?,?,?,?,?)", tid, userID(r), fields["name"], fields["color"], now(), now())
			if err == nil {
				tagIDs[key] = tid
				ts.Created++
			}
			return tid, err
		}
		if bookmarksEnabled {
			for i, tag := range input.Tags {
				if tag["deleted_at"] != nil && !includeDeleted {
					ts.Skipped++
					continue
				}
				if _, err := tagFields(copyFields(tag, "name", "color", "icon"), true); err != nil {
					ts.Failed++
					invalid("tag", i, err)
					continue
				}
				tid, err := ensureTag(str(tag["name"]), str(tag["color"]))
				if err != nil {
					return err
				}
				if icon, hasIcon := tag["icon"]; hasIcon {
					if _, err := tx.ExecContext(r.Context(), "UPDATE tags SET icon=?,updated_at=? WHERE id=? AND user_id=?", icon, now(), tid, userID(r)); err != nil {
						return err
					}
				}
			}
			for i, raw := range input.Bookmarks {
				if raw["deleted_at"] != nil && !includeDeleted {
					bs.Skipped++
					continue
				}
				values := copyFields(raw, "title", "url", "description", "favicon", "is_pinned", "is_archived", "is_public")
				if cover := str(raw["cover_image"]); validURL(cover) {
					values["cover_image"] = cover
				}
				fields, _, _, err := bookmarkFields(values, true)
				if err != nil {
					bs.Failed++
					invalid("bookmark", i, err)
					continue
				}
				names := []string{}
				validTags := true
				if tags, ok := raw["tags"].([]any); ok {
					if len(tags) > 50 {
						validTags = false
					}
					for _, v := range tags {
						name, ok := v.(string)
						if !ok || strings.TrimSpace(name) == "" || len(name) > 150 {
							validTags = false
							break
						}
						names = append(names, name)
					}
				}
				if !validTags {
					bs.Failed++
					invalid("bookmark", i, problem(400, "书签标签无效"))
					continue
				}
				old, err := one(r, tx, "SELECT id FROM bookmarks WHERE user_id=? AND url=?", userID(r), fields["url"])
				exists := err == nil
				if err != nil && !errors.Is(err, sql.ErrNoRows) {
					return err
				}
				if exists && skip {
					bs.Skipped++
					continue
				}
				bid := str(old["id"])
				if !exists {
					bid = auth.ID()
					stamp := importDate(raw["created_at"], now(), preserve)
					if _, err = tx.ExecContext(r.Context(), "INSERT INTO bookmarks(id,user_id,title,url,pin_order,created_at,updated_at) VALUES(?,?,?,?,0,?,?)", bid, userID(r), fields["title"], fields["url"], stamp, stamp); err != nil {
						return err
					}
					bs.Created++
				} else {
					bs.Updated++
				}
				fields["updated_at"] = importDate(raw["updated_at"], now(), preserve)
				fields["deleted_at"] = nil
				if raw["deleted_at"] != nil && includeDeleted {
					fields["deleted_at"] = importDate(raw["deleted_at"], now(), true)
				}
				if _, err = updateFields(r, tx, "bookmarks", fields, "id=? AND user_id=?", bid, userID(r)); err != nil {
					return err
				}
				tags := []string{}
				seen := map[string]bool{}
				for _, name := range names {
					tid, err := ensureTag(name, "")
					if err != nil {
						return err
					}
					if !seen[tid] {
						tags = append(tags, tid)
						seen[tid] = true
					}
				}
				if err = s.setTags(r, tx, bid, tags); err != nil {
					return err
				}
				if err = s.importNotes(r, tx, bookmarkNotes, bid, raw["notes"], preserve); err != nil {
					return err
				}
			}
		}
		if groupsEnabled {
			mapped := map[string]string{}
			pending := map[string]bool{}
			done := map[int]bool{}
			for _, g := range input.Groups {
				if key := str(g["id"]); key != "" {
					if pending[key] {
						return problem(400, "标签页组 ID 重复")
					}
					pending[key] = true
				}
			}
			for len(done) < len(input.Groups) {
				progress := false
				for i, raw := range input.Groups {
					if done[i] {
						continue
					}
					oldID, parent := str(raw["id"]), str(raw["parent_id"])
					if parent != "" && pending[parent] && mapped[parent] == "" {
						continue
					}
					done[i] = true
					progress = true
					delete(pending, oldID)
					rawItems, _ := raw["items"].([]any)
					if boolean(raw["is_deleted"]) && !includeDeleted {
						gs.Skipped++
						is.Skipped += len(rawItems)
						continue
					}
					values := copyFields(raw, "title", "is_folder", "position", "color", "tags")
					if parentID := mapped[parent]; parentID != "" {
						values["parent_id"] = parentID
					}
					if encoded, ok := values["tags"].(string); ok {
						var tags []any
						if json.Unmarshal([]byte(encoded), &tags) == nil {
							values["tags"] = tags
						} else {
							delete(values, "tags")
						}
					}
					fields, _, err := groupFields(values, true)
					if err != nil {
						gs.Failed++
						is.Skipped += len(rawItems)
						invalid("tab_group", i, err)
						continue
					}
					if err = s.validateParent(r, tx, "", fields["parent_id"]); err != nil {
						gs.Failed++
						is.Skipped += len(rawItems)
						invalid("tab_group", i, err)
						continue
					}
					gid := ""
					if skip {
						var found string
						err = tx.QueryRowContext(r.Context(), "SELECT id FROM tab_groups WHERE user_id=? AND title=? AND is_folder=? AND parent_id IS ? AND is_deleted=0 LIMIT 1", userID(r), fields["title"], boolean(fields["is_folder"]), fields["parent_id"]).Scan(&found)
						if err == nil {
							gid = found
							gs.Skipped++
							is.Skipped += len(rawItems)
						} else if !errors.Is(err, sql.ErrNoRows) {
							return err
						}
					}
					if gid != "" {
						mapped[oldID] = gid
						continue
					}
					gid = auth.ID()
					stamp := importDate(raw["created_at"], now(), preserve)
					if _, err = tx.ExecContext(r.Context(), "INSERT INTO tab_groups(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)", gid, userID(r), fields["title"], stamp, stamp); err != nil {
						return err
					}
					fields["updated_at"] = importDate(raw["updated_at"], stamp, preserve)
					if boolean(raw["is_deleted"]) && includeDeleted {
						fields["is_deleted"] = true
						fields["deleted_at"] = importDate(raw["deleted_at"], stamp, true)
					}
					if _, err = updateFields(r, tx, "tab_groups", fields, "id=?", gid); err != nil {
						return err
					}
					mapped[oldID] = gid
					gs.Created++
					for j, value := range rawItems {
						rawItem, ok := value.(map[string]any)
						if !ok || boolean(fields["is_folder"]) {
							is.Failed++
							invalid("tab_group_item", j, problem(400, "无效标签页或文件夹包含标签页"))
							continue
						}
						item, err := itemFields(copyFields(rawItem, "title", "url", "favicon", "position", "is_pinned", "is_todo", "is_archived"), true)
						if err != nil {
							is.Failed++
							invalid("tab_group_item", j, err)
							continue
						}
						inserted, err := s.insertItems(r, tx, gid, []object{item})
						if err != nil {
							return err
						}
						if err = s.importNotes(r, tx, tabNotes, inserted[0], rawItem["notes"], preserve); err != nil {
							return err
						}
						is.Created++
					}
				}
				if !progress {
					for i := range input.Groups {
						if !done[i] {
							gs.Failed++
							items, _ := input.Groups[i]["items"].([]any)
							is.Skipped += len(items)
							invalid("tab_group", i, problem(400, "文件夹关系存在循环"))
							done[i] = true
						}
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if bs.Created+bs.Updated > 0 {
		warnings = append(warnings, "JSON 导入不包含快照和本地图片文件，相关文件需要单独备份。")
	}
	return success(w, object{"format": input.Format, "version": input.Version, "bookmarks": bs, "tags": ts, "tab_groups": gs, "tab_group_items": is, "errors": issues, "warnings": warnings})
}
