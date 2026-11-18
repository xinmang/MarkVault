package server

import (
	"database/sql"
	"net/http"
	"strings"
	"unicode/utf8"

	"markvault/internal/auth"
	"markvault/internal/database"
)

const (
	// 单条备注的最大字符数。
	maxNoteRunes = 2000
	// 每个书签或标签页最多保留的备注数，防止脚本无限追加。
	maxNotesPerTarget = 1000
	// 列表响应里每条记录附带的备注预览：条数与每条的最大字符数。
	notePreviewCount = 3
	notePreviewRunes = 200
	// 书签详情直接附带的完整备注条数，更早的记录通过备注列表接口分页读取。
	noteDetailCount = 50
)

// agentCallKey 标记由 Agent 工具发起的请求，用于区分站内助手和本人在界面中的操作。
type agentCallKey struct{}

// noteTarget 描述备注挂在哪类记录上，以及读写它所需的权限。
type noteTarget struct {
	column string
	read   string
	note   string
	update string
}

var (
	bookmarkNotes = noteTarget{"bookmark_id", "bookmarks.read", "bookmarks.note", "bookmarks.update"}
	tabNotes      = noteTarget{"tab_item_id", "tab_groups.read", "tab_groups.note", "tab_groups.update"}
)

const noteColumns = "id,bookmark_id,tab_item_id,content,source,source_name,is_pinned,created_at,updated_at"

// noteOwner 确认备注目标属于当前账号；回收站里的书签和标签页组不能再追加备注。
func (s *Server) noteOwner(r *http.Request, db database.Queryer, t noteTarget, target string, writing bool) error {
	var err error
	if t.column == "bookmark_id" {
		filter := ""
		if writing {
			filter = " AND deleted_at IS NULL"
		}
		_, err = one(r, db, "SELECT id FROM bookmarks WHERE id=? AND user_id=?"+filter, target, userID(r))
	} else {
		_, err = one(r, db, "SELECT id FROM tab_group_items WHERE "+ownedItem, target, userID(r))
	}
	return err
}

func noteRow(row object) object {
	bools(row, "is_pinned")
	for _, key := range []string{"bookmark_id", "tab_item_id"} {
		if row[key] == nil {
			delete(row, key)
		}
	}
	return row
}

func noteFields(body object, creating bool) (object, error) {
	if body == nil {
		return nil, problem(400, "缺少备注内容")
	}
	fields := object{}
	for key, value := range body {
		switch key {
		case "content":
			text, ok := value.(string)
			text = strings.TrimSpace(text)
			if !ok || text == "" {
				return nil, problem(400, "备注内容不能为空")
			}
			if utf8.RuneCountInString(text) > maxNoteRunes {
				return nil, problem(400, "备注不能超过 2000 字符")
			}
			fields[key] = text
		case "is_pinned":
			pinned, ok := value.(bool)
			if !ok {
				return nil, problem(400, "is_pinned 必须为布尔值")
			}
			fields[key] = pinned
		default:
			return nil, problem(400, "不支持的备注字段: "+key)
		}
	}
	if creating && fields["content"] == nil {
		return nil, problem(400, "备注内容不能为空")
	}
	return fields, nil
}

// noteSource 判断备注的写入者。API Key 和站内助手都记为 Agent，不根据客户端选择的 URL 判定身份。
func (s *Server) noteSource(r *http.Request) (string, string) {
	if key := who(r).APIKeyID; key != "" {
		name := ""
		if row, err := one(r, s.db, "SELECT name FROM api_keys WHERE id=?", key); err == nil {
			name = str(row["name"])
		}
		return "agent", name
	}
	if r.Context().Value(agentCallKey{}) != nil {
		return "agent", ""
	}
	return "user", ""
}

// attachNotes 给书签或标签页附上备注数量 note_count 和备注列表 notes（置顶在前，其余按时间倒序）。
// limit 大于 0 时每条记录最多附带 limit 条；clip 大于 0 时截断过长内容并标记 truncated。
func (s *Server) attachNotes(r *http.Request, db database.Queryer, t noteTarget, rows []object, limit, clip int) error {
	byID := map[string]object{}
	for _, row := range rows {
		row["notes"] = []object{}
		row["note_count"] = int64(0)
		byID[str(row["id"])] = row
	}
	// 分批查询以控制 SQLite 参数数量。
	for start := 0; start < len(rows); start += 500 {
		chunk := rows[start:min(start+500, len(rows))]
		args := []any{userID(r)}
		for _, row := range chunk {
			args = append(args, row["id"])
		}
		query := "SELECT * FROM (SELECT id," + t.column + " AS target_id,content,source,source_name,is_pinned,created_at,updated_at," +
			"ROW_NUMBER() OVER (PARTITION BY " + t.column + " ORDER BY is_pinned DESC,created_at DESC,id DESC) AS position," +
			"COUNT(*) OVER (PARTITION BY " + t.column + ") AS total FROM notes WHERE user_id=? AND " + t.column + " IN (" + placeholders(len(chunk)) + "))"
		if limit > 0 {
			query += " WHERE position<=?"
			args = append(args, limit)
		}
		notes, err := all(r, db, query+" ORDER BY target_id,position", args...)
		if err != nil {
			return err
		}
		for _, note := range notes {
			row := byID[str(note["target_id"])]
			row["note_count"] = number(note["total"])
			delete(note, "target_id")
			delete(note, "position")
			delete(note, "total")
			bools(note, "is_pinned")
			if content := []rune(str(note["content"])); clip > 0 && len(content) > clip {
				note["content"] = string(content[:clip]) + "…"
				note["truncated"] = true
			}
			row["notes"] = append(row["notes"].([]object), note)
		}
	}
	return nil
}

// attachItemNotes 给标签页组里的标签页附上备注预览。公开分享不调用它，备注不会出现在分享链接中。
func (s *Server) attachItemNotes(r *http.Request, db database.Queryer, groups []object, limit, clip int) error {
	items := []object{}
	for _, group := range groups {
		list, _ := group["items"].([]object)
		items = append(items, list...)
	}
	return s.attachNotes(r, db, tabNotes, items, limit, clip)
}

func (s *Server) listNotes(t noteTarget) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if err := permit(r, t.read); err != nil {
			return err
		}
		if err := s.noteOwner(r, s.db, t, id(r), false); err != nil {
			return err
		}
		size, offset, err := page(r)
		if err != nil {
			return err
		}
		rows, err := all(r, s.db, "SELECT "+noteColumns+" FROM notes WHERE user_id=? AND "+t.column+"=? ORDER BY is_pinned DESC,created_at DESC,id DESC LIMIT ? OFFSET ?", userID(r), id(r), size+1, offset)
		if err != nil {
			return err
		}
		for _, row := range rows {
			noteRow(row)
		}
		var total int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM notes WHERE user_id=? AND "+t.column+"=?", userID(r), id(r)).Scan(&total); err != nil {
			return err
		}
		result := pageResult("notes", rows, size, offset)
		result["meta"].(object)["total"] = total
		return success(w, result)
	}
}

func (s *Server) createNote(t noteTarget) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if err := permit(r, t.note); err != nil {
			return err
		}
		var body object
		if err := decode(w, r, &body); err != nil {
			return err
		}
		fields, err := noteFields(body, true)
		if err != nil {
			return err
		}
		source, name := s.noteSource(r)
		nid, stamp := auth.ID(), now()
		err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
			if err := s.noteOwner(r, tx, t, id(r), true); err != nil {
				return err
			}
			var count int
			if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM notes WHERE user_id=? AND "+t.column+"=?", userID(r), id(r)).Scan(&count); err != nil {
				return err
			}
			if count >= maxNotesPerTarget {
				return problem(400, "备注数量已达上限，请先清理旧备注")
			}
			_, err := tx.ExecContext(r.Context(), "INSERT INTO notes(id,user_id,"+t.column+",content,source,source_name,is_pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", nid, userID(r), id(r), fields["content"], source, name, boolean(fields["is_pinned"]), stamp, stamp)
			return err
		})
		if err != nil {
			return err
		}
		// 追加权限不隐含读取权限，没有读取权限时只返回新备注的 ID。
		if permit(r, t.read) != nil {
			return created(w, object{"note": object{"id": nid}})
		}
		row, err := one(r, s.db, "SELECT "+noteColumns+" FROM notes WHERE id=? AND user_id=?", nid, userID(r))
		if err != nil {
			return err
		}
		return created(w, object{"note": noteRow(row)})
	}
}

// editableNote 找到当前账号的一条备注并校验修改权限，返回它所属的目标类型。
// 修改和删除会改动已有记录，需要对应的修改权限；只有追加权限的 Key 不能改写历史。
func (s *Server) editableNote(r *http.Request) (noteTarget, error) {
	row, err := one(r, s.db, "SELECT bookmark_id FROM notes WHERE id=? AND user_id=?", id(r), userID(r))
	if err != nil {
		// 两类修改权限都没有的 Key 不能借此探测备注是否存在。
		if denied := permit(r, bookmarkNotes.update); denied != nil && permit(r, tabNotes.update) != nil {
			return noteTarget{}, denied
		}
		return noteTarget{}, err
	}
	target := tabNotes
	if row["bookmark_id"] != nil {
		target = bookmarkNotes
	}
	return target, permit(r, target.update)
}

func (s *Server) updateNote(w http.ResponseWriter, r *http.Request) error {
	target, err := s.editableNote(r)
	if err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, err := noteFields(body, false)
	if err != nil {
		return err
	}
	if len(fields) == 0 {
		return problem(400, "没有可更新的字段")
	}
	// 只切换置顶不算编辑，updated_at 仅在内容变化时更新。
	if _, ok := fields["content"]; ok {
		fields["updated_at"] = now()
	}
	if err := affected(updateFields(r, s.db, "notes", fields, "id=? AND user_id=?", id(r), userID(r))); err != nil {
		return err
	}
	if permit(r, target.read) != nil {
		return success(w, object{"note": object{"id": id(r)}})
	}
	row, err := one(r, s.db, "SELECT "+noteColumns+" FROM notes WHERE id=? AND user_id=?", id(r), userID(r))
	if err != nil {
		return err
	}
	return success(w, object{"note": noteRow(row)})
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.editableNote(r); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "DELETE FROM notes WHERE id=? AND user_id=?", id(r), userID(r))); err != nil {
		return err
	}
	return empty(w)
}

// importNotes 合并备份中的备注；保留时间戳时按内容和创建时间去重。
func (s *Server) importNotes(r *http.Request, tx *sql.Tx, t noteTarget, target string, raw any, preserve bool) error {
	values, _ := raw.([]any)
	if len(values) > maxNotesPerTarget {
		return problem(400, "每个目标最多导入 1000 条备注")
	}
	if len(values) == 0 {
		return nil
	}
	var count int64
	if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM notes WHERE user_id=? AND "+t.column+"=?", userID(r), target).Scan(&count); err != nil {
		return err
	}
	for _, value := range values {
		note, ok := value.(map[string]any)
		if !ok {
			continue
		}
		content := strings.TrimSpace(str(note["content"]))
		if content == "" || utf8.RuneCountInString(content) > maxNoteRunes {
			continue
		}
		source := str(note["source"])
		if source != "agent" {
			source = "user"
		}
		name := str(note["source_name"])
		if utf8.RuneCountInString(name) > 200 {
			name = ""
		}
		stamp := importDate(note["created_at"], now(), preserve)
		result, err := tx.ExecContext(r.Context(), "INSERT INTO notes(id,user_id,"+t.column+",content,source,source_name,is_pinned,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM notes WHERE user_id=? AND "+t.column+"=? AND content=? AND created_at=?)",
			auth.ID(), userID(r), target, content, source, name, boolean(note["is_pinned"]), stamp, importDate(note["updated_at"], stamp, preserve), userID(r), target, content, stamp)
		if err != nil {
			return err
		}
		added, err := result.RowsAffected()
		if err != nil {
			return err
		}
		count += added
		if count > maxNotesPerTarget {
			return problem(400, "合并后备注数量超过上限，请先清理旧备注")
		}
	}
	return nil
}

// exportNotes 把备注整理成备份文件里的形式，只保留可迁移的字段。
func exportNotes(row object) []object {
	notes, _ := row["notes"].([]object)
	result := []object{}
	for _, note := range notes {
		result = append(result, copyFields(note, "content", "source", "source_name", "is_pinned", "created_at", "updated_at"))
	}
	return result
}
