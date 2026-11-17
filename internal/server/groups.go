package server

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strings"

	"markvault/internal/auth"
	"markvault/internal/database"
)

func groupFields(body object, creating bool) (object, []object, error) {
	if body == nil {
		return nil, nil, problem(400, "缺少标签页组内容")
	}
	fields := object{}
	items := []object{}
	for k, v := range body {
		switch k {
		case "title":
			text, ok := v.(string)
			if !ok || strings.TrimSpace(text) == "" || len(text) > 1500 {
				return nil, nil, problem(400, "组名称无效")
			}
			fields[k] = strings.TrimSpace(text)
		case "parent_id":
			if v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 128 || text == "" {
					return nil, nil, problem(400, "父级 ID 无效")
				}
			}
			fields[k] = v
		case "position":
			n, ok := v.(float64)
			if !ok || n < 0 || n > 1000000 || n != math.Trunc(n) {
				return nil, nil, problem(400, "位置必须为非负整数")
			}
			fields[k] = n
		case "is_folder":
			if !creating {
				return nil, nil, problem(400, "不能变更文件夹类型")
			}
			if _, ok := v.(bool); !ok {
				n, ok := v.(float64)
				if !ok || (n != 0 && n != 1) {
					return nil, nil, problem(400, "文件夹类型无效")
				}
			}
			fields[k] = boolean(v)
		case "color":
			if v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 30 {
					return nil, nil, problem(400, "颜色无效")
				}
			}
			fields[k] = v
		case "tags":
			if v == nil {
				fields[k] = nil
				continue
			}
			values, ok := v.([]any)
			if !ok || len(values) > 50 {
				return nil, nil, problem(400, "标签格式无效")
			}
			for _, tag := range values {
				if text, ok := tag.(string); !ok || len(text) > 150 {
					return nil, nil, problem(400, "标签格式无效")
				}
			}
			encoded, _ := json.Marshal(values)
			fields[k] = string(encoded)
		case "items":
			if !creating {
				return nil, nil, problem(400, "请使用标签页批量添加接口")
			}
			values, ok := v.([]any)
			if !ok || len(values) > 500 {
				return nil, nil, problem(400, "每次最多添加 500 个标签页")
			}
			for _, value := range values {
				item, ok := value.(map[string]any)
				if !ok {
					return nil, nil, problem(400, "标签页格式无效")
				}
				validated, err := itemFields(item, true)
				if err != nil {
					return nil, nil, err
				}
				items = append(items, validated)
			}
		default:
			return nil, nil, problem(400, "未知标签页组字段: "+k)
		}
	}
	if creating && fields["title"] == nil {
		fields["title"] = "未命名标签页组"
	}
	if boolean(fields["is_folder"]) && len(items) > 0 {
		return nil, nil, problem(400, "文件夹不能直接包含标签页")
	}
	return fields, items, nil
}
func itemFields(body object, creating bool) (object, error) {
	fields := object{}
	for k, v := range body {
		switch k {
		case "title":
			text, ok := v.(string)
			if !ok || strings.TrimSpace(text) == "" || len(text) > 1500 {
				return nil, problem(400, "标签页标题无效")
			}
			fields[k] = text
		case "url":
			text, ok := v.(string)
			if !ok || !validURL(text) {
				return nil, problem(400, "标签页 URL 无效")
			}
			fields[k] = text
		case "favicon":
			if v != nil {
				text, ok := v.(string)
				if !ok || (text != "" && !validURL(text)) {
					return nil, problem(400, "图标 URL 无效")
				}
			}
			fields[k] = v
		case "position":
			n, ok := v.(float64)
			if !ok || n < 0 || n > 1000000 || n != math.Trunc(n) {
				return nil, problem(400, "位置无效")
			}
			fields[k] = n
		case "is_pinned", "is_todo", "is_archived":
			if _, ok := v.(bool); !ok {
				return nil, problem(400, "标签页状态必须为布尔值")
			}
			fields[k] = v
		default:
			return nil, problem(400, "未知标签页字段: "+k)
		}
	}
	if creating && (fields["title"] == nil || fields["url"] == nil) {
		return nil, problem(400, "标签页标题和 URL 不能为空")
	}
	return fields, nil
}
func (s *Server) validateParent(r *http.Request, tx *sql.Tx, gid string, parent any) error {
	if parent == nil {
		return nil
	}
	pid := str(parent)
	if pid == gid {
		return problem(400, "不能移动到自身")
	}
	if _, err := one(r, tx, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_folder=1 AND is_deleted=0", pid, userID(r)); err != nil {
		if err == sql.ErrNoRows {
			return problem(400, "父文件夹不存在或不属于当前账号")
		}
		return err
	}
	var count int
	err := tx.QueryRowContext(r.Context(), `WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM tab_groups WHERE id=? AND user_id=? UNION SELECT g.id,g.parent_id FROM tab_groups g JOIN ancestors a ON a.parent_id=g.id WHERE g.user_id=?) SELECT COUNT(*) FROM ancestors WHERE id=?`, pid, userID(r), userID(r), gid).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return problem(400, "不能移动到自己的子文件夹")
	}
	return nil
}
func (s *Server) groups(r *http.Request, db database.Queryer, rows []object) error {
	if len(rows) == 0 {
		return nil
	}
	byID := map[string]object{}
	args := []any{}
	for _, row := range rows {
		var tags any
		if raw := str(row["tags"]); raw != "" {
			if err := json.Unmarshal([]byte(raw), &tags); err != nil {
				return err
			}
		}
		row["tags"] = tags
		row["items"] = []object{}
		row["item_count"] = 0
		byID[str(row["id"])] = row
		args = append(args, row["id"])
	}
	items, err := all(r, db, "SELECT * FROM tab_group_items WHERE group_id IN ("+placeholders(len(rows))+") ORDER BY is_pinned DESC,position,id", args...)
	if err != nil {
		return err
	}
	for _, item := range items {
		bools(item, "is_pinned", "is_todo", "is_archived")
		row := byID[str(item["group_id"])]
		row["items"] = append(row["items"].([]object), item)
		row["item_count"] = row["item_count"].(int) + 1
	}
	return nil
}
func (s *Server) getGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.read"); err != nil {
		return err
	}
	return s.groupResponse(w, r)
}
func (s *Server) groupResponse(w http.ResponseWriter, r *http.Request) error {
	row, err := one(r, s.db, "SELECT * FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0", id(r), userID(r))
	if err != nil {
		return err
	}
	if permit(r, "tab_groups.read") != nil {
		return success(w, object{"tab_group": copyFields(row, "id")})
	}
	if err = s.groups(r, s.db, []object{row}); err != nil {
		return err
	}
	return success(w, object{"tab_group": row})
}
func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.read"); err != nil {
		return err
	}
	size, offset, err := page(r)
	if err != nil {
		return err
	}
	deleted := strings.HasSuffix(r.URL.Path, "/trash")
	// 旧实现：列表按创建时间倒序，回收站按删除时间倒序。
	order := "created_at DESC,id DESC"
	if deleted {
		order = "deleted_at DESC,id DESC"
	}
	rows, err := all(r, s.db, "SELECT * FROM tab_groups WHERE user_id=? AND is_deleted=? ORDER BY "+order+" LIMIT ? OFFSET ?", userID(r), deleted, size+1, offset)
	if err != nil {
		return err
	}
	if err = s.groups(r, s.db, rows); err != nil {
		return err
	}
	return success(w, pageResult("tab_groups", rows, size, offset))
}
func (s *Server) insertItems(r *http.Request, tx *sql.Tx, gid string, items []object) error {
	var offset int
	if err := tx.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(position),-1)+1 FROM tab_group_items WHERE group_id=?", gid).Scan(&offset); err != nil {
		return err
	}
	for i, fields := range items {
		iid := auth.ID()
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO tab_group_items(id,group_id,title,url,favicon,position,created_at) VALUES(?,?,?,?,?,?,?)", iid, gid, fields["title"], fields["url"], fields["favicon"], offset+i, now()); err != nil {
			return err
		}
		if _, err := updateFields(r, tx, "tab_group_items", fields, "id=?", iid); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.create"); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, items, err := groupFields(body, true)
	if err != nil {
		return err
	}
	gid := auth.ID()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if err := s.validateParent(r, tx, gid, fields["parent_id"]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO tab_groups(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)", gid, userID(r), fields["title"], now(), now()); err != nil {
			return err
		}
		if _, err := updateFields(r, tx, "tab_groups", fields, "id=? AND user_id=?", gid, userID(r)); err != nil {
			return err
		}
		return s.insertItems(r, tx, gid, items)
	})
	if err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM tab_groups WHERE id=? AND user_id=?", gid, userID(r))
	if err != nil {
		return err
	}
	if permit(r, "tab_groups.read") != nil {
		return created(w, object{"tab_group": copyFields(row, "id")})
	}
	if err = s.groups(r, s.db, []object{row}); err != nil {
		return err
	}
	return created(w, object{"tab_group": row})
}
func (s *Server) updateGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, _, err := groupFields(body, false)
	if err != nil {
		return err
	}
	fields["updated_at"] = now()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if parent, ok := fields["parent_id"]; ok {
			if err := s.validateParent(r, tx, id(r), parent); err != nil {
				return err
			}
		}
		return affected(updateFields(r, tx, "tab_groups", fields, "id=? AND user_id=? AND is_deleted=0", id(r), userID(r)))
	})
	if err != nil {
		return err
	}
	return s.groupResponse(w, r)
}
func (s *Server) batchGroups(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	var body struct {
		Updates []object `json:"updates"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if len(body.Updates) < 1 || len(body.Updates) > 200 {
		return problem(400, "每次需更新 1–200 个组")
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		for _, item := range body.Updates {
			gid := str(item["id"])
			delete(item, "id")
			fields, _, err := groupFields(item, false)
			if err != nil {
				return err
			}
			if p, ok := fields["parent_id"]; ok {
				if err := s.validateParent(r, tx, gid, p); err != nil {
					return err
				}
			}
			fields["updated_at"] = now()
			if err := affected(updateFields(r, tx, "tab_groups", fields, "id=? AND user_id=? AND is_deleted=0", gid, userID(r))); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return success(w, object{"message": "排序已更新", "updated_count": len(body.Updates)})
}

const descendantSQL = `WITH RECURSIVE descendants(id) AS (SELECT id FROM tab_groups WHERE id=? AND user_id=? UNION SELECT g.id FROM tab_groups g JOIN descendants d ON g.parent_id=d.id WHERE g.user_id=?) `

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.delete"); err != nil {
		return err
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0", id(r), userID(r)); err != nil {
			return err
		}
		stamp := now()
		_, err := tx.ExecContext(r.Context(), descendantSQL+"UPDATE tab_groups SET is_deleted=1,deleted_at=?,updated_at=? WHERE id IN (SELECT id FROM descendants) AND user_id=? AND is_deleted=0", id(r), userID(r), userID(r), stamp, stamp, userID(r))
		return err
	})
	if err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) restoreGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		row, err := one(r, tx, "SELECT deleted_at,parent_id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=1", id(r), userID(r))
		if err != nil {
			return err
		}
		// 父文件夹仍在回收站时，将恢复的根组放回顶层。
		if _, err := tx.ExecContext(r.Context(), "UPDATE tab_groups SET parent_id=NULL WHERE id=? AND user_id=? AND parent_id IN (SELECT id FROM tab_groups WHERE user_id=? AND is_deleted=1)", id(r), userID(r), userID(r)); err != nil {
			return err
		}
		_, err = tx.ExecContext(r.Context(), descendantSQL+"UPDATE tab_groups SET is_deleted=0,deleted_at=NULL,updated_at=? WHERE id IN (SELECT id FROM descendants) AND user_id=? AND deleted_at=?", id(r), userID(r), userID(r), now(), userID(r), row["deleted_at"])
		return err
	})
	if err != nil {
		return err
	}
	return s.groupResponse(w, r)
}
func (s *Server) permanentGroup(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.delete"); err != nil {
		return err
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=1", id(r), userID(r)); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), descendantSQL+"DELETE FROM tab_groups WHERE id IN (SELECT id FROM descendants) AND user_id=? AND is_deleted=1", id(r), userID(r), userID(r), userID(r))
		return err
	})
	if err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) addGroupItems(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	_, items, err := groupFields(body, true)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return problem(400, "请提供标签页")
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0 AND is_folder=0", id(r), userID(r)); err != nil {
			return err
		}
		if err := s.insertItems(r, tx, id(r), items); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), "UPDATE tab_groups SET updated_at=? WHERE id=? AND user_id=?", now(), id(r), userID(r))
		return err
	})
	if err != nil {
		return err
	}
	// 添加标签页不授予读取组内其他标签页的权限。
	if permit(r, "tab_groups.read") != nil {
		return success(w, object{"message": "标签页已添加", "added_count": len(items)})
	}
	rows, err := all(r, s.db, "SELECT * FROM tab_group_items WHERE group_id=? ORDER BY position,id", id(r))
	if err != nil {
		return err
	}
	for _, row := range rows {
		bools(row, "is_pinned", "is_todo", "is_archived")
	}
	return success(w, object{"message": "标签页已添加", "added_count": len(items), "total_items": len(rows), "items": rows})
}

const ownedItem = `id=? AND group_id IN (SELECT id FROM tab_groups WHERE user_id=? AND is_deleted=0)`

func (s *Server) updateGroupItem(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, err := itemFields(body, false)
	if err != nil {
		return err
	}
	if err := affected(updateFields(r, s.db, "tab_group_items", fields, ownedItem, id(r), userID(r))); err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM tab_group_items WHERE "+ownedItem, id(r), userID(r))
	if err != nil {
		return err
	}
	if permit(r, "tab_groups.read") != nil {
		return success(w, object{"item": copyFields(row, "id")})
	}
	bools(row, "is_pinned", "is_todo", "is_archived")
	return success(w, object{"item": row})
}
func (s *Server) deleteGroupItem(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.delete"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "DELETE FROM tab_group_items WHERE "+ownedItem, id(r), userID(r))); err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) moveGroupItem(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tab_groups.update"); err != nil {
		return err
	}
	var body struct {
		Target   string `json:"target_group_id"`
		Position *int   `json:"position"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	if body.Position != nil && (*body.Position < 0 || *body.Position > 1000000) {
		return problem(400, "位置无效")
	}
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0 AND is_folder=0", body.Target, userID(r)); err != nil {
			return err
		}
		var pos int
		if body.Position != nil {
			pos = *body.Position
		} else {
			if err := tx.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(position),-1)+1 FROM tab_group_items WHERE group_id=?", body.Target).Scan(&pos); err != nil {
				return err
			}
		}
		return affected(tx.ExecContext(r.Context(), "UPDATE tab_group_items SET group_id=?,position=? WHERE "+ownedItem, body.Target, pos, id(r), userID(r)))
	})
	if err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM tab_group_items WHERE "+ownedItem, id(r), userID(r))
	if err != nil {
		return err
	}
	if permit(r, "tab_groups.read") != nil {
		return success(w, object{"item": copyFields(row, "id")})
	}
	bools(row, "is_pinned", "is_todo", "is_archived")
	return success(w, object{"item": row})
}
