package server

import (
	"database/sql"
	"markvault/internal/auth"
	"net/http"
	"strings"
	"unicode/utf8"
)

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tags.read"); err != nil {
		return err
	}
	order := "bookmark_count DESC,lower(t.name)"
	switch r.URL.Query().Get("sort") {
	case "name":
		order = "lower(t.name)"
	case "clicks":
		order = "t.click_count DESC,lower(t.name)"
	}
	rows, err := all(r, s.db, `SELECT t.*,COUNT(b.id) AS bookmark_count FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id=t.id AND bt.user_id=t.user_id LEFT JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=t.user_id AND b.deleted_at IS NULL WHERE t.user_id=? AND t.deleted_at IS NULL GROUP BY t.id ORDER BY `+order, userID(r))
	if err != nil {
		return err
	}
	return success(w, object{"tags": rows})
}
func tagFields(body object, creating bool) (object, error) {
	if body == nil {
		return nil, problem(400, "缺少标签内容")
	}
	fields := object{}
	for key, value := range body {
		switch key {
		case "name":
			text, ok := value.(string)
			text = strings.TrimSpace(text)
			if !ok || text == "" || utf8.RuneCountInString(text) > 50 {
				return nil, problem(400, "标签名称需为 1–50 字符")
			}
			fields[key] = text
		case "icon":
			if !validTagIcon(value) {
				return nil, problem(400, "标签图标无效，请选择内置图标、HTTP(S) 图片链接或不超过 64 KB 的 PNG、JPEG、GIF、WebP 图片")
			}
			fields[key] = value
		case "color":
			if value != nil {
				text, ok := value.(string)
				if !ok || len(text) > 20 {
					return nil, problem(400, "标签颜色无效")
				}
			}
			fields[key] = value
		default:
			return nil, problem(400, "未知标签字段: "+key)
		}
	}
	if creating && fields["name"] == nil {
		return nil, problem(400, "标签名称不能为空")
	}
	return fields, nil
}
func (s *Server) createTag(w http.ResponseWriter, r *http.Request) error {
	return s.writeTag(w, r, true)
}
func (s *Server) updateTag(w http.ResponseWriter, r *http.Request) error {
	return s.writeTag(w, r, false)
}
func (s *Server) writeTag(w http.ResponseWriter, r *http.Request, creating bool) error {
	permission := "tags.update"
	if creating {
		permission = "tags.create"
	}
	if err := permit(r, permission); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	fields, err := tagFields(body, creating)
	if err != nil {
		return err
	}
	tid := id(r)
	if creating {
		tid = auth.ID()
	}
	fields["updated_at"] = now()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if name, ok := fields["name"]; ok {
			var count int
			if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM tags WHERE user_id=? AND lower(name)=lower(?) AND id<>?", userID(r), name, tid).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return problem(409, "标签名称已存在")
			}
		}
		if creating {
			if _, err := tx.ExecContext(r.Context(), "INSERT INTO tags(id,user_id,name,created_at) VALUES(?,?,?,?)", tid, userID(r), fields["name"], now()); err != nil {
				return err
			}
		}
		return affected(updateFields(r, tx, "tags", fields, "id=? AND user_id=? AND deleted_at IS NULL", tid, userID(r)))
	})
	if err != nil {
		return err
	}
	row, err := one(r, s.db, "SELECT * FROM tags WHERE id=? AND user_id=?", tid, userID(r))
	if err != nil {
		return err
	}
	if permit(r, "tags.read") != nil {
		row = copyFields(row, "id")
	}
	if creating {
		return created(w, object{"tag": row})
	}
	return success(w, object{"tag": row})
}
func (s *Server) deleteTag(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tags.delete"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "DELETE FROM tags WHERE id=? AND user_id=?", id(r), userID(r))); err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) clickTag(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tags.read"); err != nil {
		return err
	}
	if err := s.rate(r, w, "click:"+userID(r), clickRateLimit, 60); err != nil {
		return err
	}
	stamp := now()
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if err := affected(tx.ExecContext(r.Context(), "UPDATE tags SET click_count=click_count+1,last_clicked_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL", stamp, id(r), userID(r))); err != nil {
			return err
		}
		// 明细供按日期统计使用，累计次数仍保留在 tags.click_count。
		_, err := tx.ExecContext(r.Context(), "INSERT INTO tag_click_events(tag_id,user_id,clicked_at) VALUES(?,?,?)", id(r), userID(r), stamp)
		return err
	})
	if err != nil {
		return err
	}
	return success(w, object{"message": "已记录访问", "clicked_at": stamp})
}
