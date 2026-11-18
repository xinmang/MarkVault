package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"markvault/internal/auth"
	"markvault/internal/database"
)

func stringInt(v int64) string { return strconv.FormatInt(v, 10) }
func escapeLike(v string) string {
	return "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(v) + "%"
}
func uniqueIDs(ids []string) ([]string, error) {
	if len(ids) > 100 {
		return nil, problem(400, "每次最多处理 100 项")
	}
	seen := map[string]bool{}
	result := []string{}
	for _, v := range ids {
		if v == "" || len(v) > 128 {
			return nil, problem(400, "无效的记录 ID")
		}
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	return result, nil
}
func (s *Server) bookmark(r *http.Request, db database.Queryer, bid string) (object, error) {
	row, err := one(r, db, "SELECT * FROM bookmarks WHERE user_id=? AND id=?", userID(r), bid)
	if err != nil {
		return nil, err
	}
	if err := s.decorateOwnedBookmarks(r, db, []object{row}, noteDetailCount, 0); err != nil {
		return nil, err
	}
	return row, nil
}

// 写入权限不隐含读取权限，响应不能泄漏原记录的描述、标签或图片签名。
func (s *Server) bookmarkWriteResult(r *http.Request, bid string) (object, error) {
	if permit(r, "bookmarks.read") != nil {
		return object{"id": bid}, nil
	}
	return s.bookmark(r, s.db, bid)
}

func (s *Server) decorateBookmarks(r *http.Request, db database.Queryer, rows []object) error {
	return s.decorateOwnedBookmarks(r, db, rows, notePreviewCount, notePreviewRunes)
}

func (s *Server) decorateOwnedBookmarks(r *http.Request, db database.Queryer, rows []object, limit, clip int) error {
	if err := s.decorateBookmarkData(r, db, rows); err != nil {
		return err
	}
	s.signBookmarkImages(userID(r), rows, "owner")
	if err := s.attachScreenshots(r, db, userID(r), rows, "owner"); err != nil {
		return err
	}
	// 备注只随本人的读取接口返回，公开分享页不经过这里。
	return s.attachNotes(r, db, bookmarkNotes, rows, limit, clip)
}

// 导出只装饰业务数据，临时图片签名不进入备份或数据库。
func (s *Server) decorateBookmarkData(r *http.Request, db database.Queryer, rows []object) error {
	if len(rows) == 0 {
		return nil
	}
	args := []any{userID(r)}
	byID := map[string]object{}
	for _, row := range rows {
		bools(row, "is_pinned", "is_archived", "is_public", "has_snapshot")
		row["tags"] = []object{}
		byID[str(row["id"])] = row
		args = append(args, row["id"])
	}
	tags, err := all(r, db, `SELECT bt.bookmark_id,t.id,t.name,t.color FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id AND t.user_id=bt.user_id WHERE bt.user_id=? AND t.deleted_at IS NULL AND bt.bookmark_id IN (`+placeholders(len(rows))+`) ORDER BY lower(t.name),t.id`, args...)
	if err != nil {
		return err
	}
	for _, tag := range tags {
		row := byID[str(tag["bookmark_id"])]
		delete(tag, "bookmark_id")
		row["tags"] = append(row["tags"].([]object), tag)
	}
	return nil
}

type bookmarkCursor struct {
	ID       string `json:"id"`
	Pinned   bool   `json:"isPinned"`
	PinOrder *int64 `json:"pinOrder"`
	Value    any    `json:"sortValue"`
}

func (s *Server) listBookmarks(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	q := r.URL.Query()
	size := 100
	if raw := q.Get("page_size"); raw != "" {
		// 与旧实现一致：非法或 0 回退默认值，超出范围静默截断而不报错。
		v, e := strconv.Atoi(raw)
		if e != nil || v == 0 {
			v = size
		}
		size = min(max(v, 1), 200)
	}
	field := "b.created_at"
	switch q.Get("sort") {
	case "updated":
		field = "b.updated_at"
	case "popular":
		field = "b.click_count"
	case "", "created", "pinned":
	default:
		return problem(400, "未知排序方式")
	}
	where := "b.user_id=? AND b.deleted_at IS NULL"
	args := []any{userID(r)}
	if strings.HasSuffix(r.URL.Path, "/trash") {
		where = "b.user_id=? AND b.deleted_at IS NOT NULL"
		field = "b.deleted_at"
	}
	for _, key := range []string{"archived", "pinned", "public"} {
		if raw := q.Get(key); raw != "" {
			if raw != "true" && raw != "false" {
				return problem(400, key+" 必须为 true 或 false")
			}
			where += " AND b.is_" + key + "=?"
			args = append(args, raw == "true")
		}
	}
	if raw := strings.TrimSpace(q.Get("keyword")); raw != "" {
		if utf8.RuneCountInString(raw) > 500 {
			return problem(400, "搜索词过长")
		}
		where += ` AND (b.title LIKE ? ESCAPE '!' OR b.url LIKE ? ESCAPE '!' OR b.description LIKE ? ESCAPE '!' OR EXISTS(SELECT 1 FROM notes n WHERE n.bookmark_id=b.id AND n.user_id=b.user_id AND n.content LIKE ? ESCAPE '!'))`
		pattern := escapeLike(raw)
		args = append(args, pattern, pattern, pattern, pattern)
	}
	selectedTags := []string{}
	if raw := q.Get("tags"); raw != "" {
		tags, err := uniqueIDs(strings.Split(raw, ","))
		if err != nil {
			return err
		}
		selectedTags = tags
		where += " AND (SELECT COUNT(DISTINCT bt.tag_id) FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id AND t.user_id=bt.user_id AND t.deleted_at IS NULL WHERE bt.bookmark_id=b.id AND bt.user_id=b.user_id AND bt.tag_id IN (" + placeholders(len(tags)) + "))=?"
		for _, tag := range tags {
			args = append(args, tag)
		}
		args = append(args, len(tags))
	}
	// 待选标签复用完整筛选条件；游标和页大小只能裁剪书签列表。
	relatedWhere := where
	relatedArgs := append([]any{}, args...)
	if raw := q.Get("page_cursor"); raw != "" {
		var c bookmarkCursor
		if err := json.Unmarshal([]byte(raw), &c); err != nil || c.ID == "" || c.Value == nil {
			return problem(400, "分页游标无效")
		}
		switch c.Value.(type) {
		case string, float64:
		default:
			return problem(400, "分页游标无效")
		}
		order := int64(0)
		if c.PinOrder != nil {
			order = *c.PinOrder
		}
		where += " AND (b.is_pinned<? OR (b.is_pinned=? AND (CASE WHEN b.is_pinned=1 THEN COALESCE(b.pin_order,0) ELSE 0 END>? OR (CASE WHEN b.is_pinned=1 THEN COALESCE(b.pin_order,0) ELSE 0 END=? AND (" + field + "<? OR (" + field + "=? AND b.id<?))))))"
		args = append(args, c.Pinned, c.Pinned, order, order, c.Value, c.Value, c.ID)
	}
	args = append(args, size+1)
	rows, err := all(r, s.db, "SELECT b.* FROM bookmarks b WHERE "+where+" ORDER BY b.is_pinned DESC,CASE WHEN b.is_pinned=1 THEN COALESCE(b.pin_order,0) ELSE 0 END ASC,"+field+" DESC,b.id DESC LIMIT ?", args...)
	if err != nil {
		return err
	}
	more := len(rows) > size
	if more {
		rows = rows[:size]
	}
	if err := s.decorateBookmarks(r, s.db, rows); err != nil {
		return err
	}
	relatedTagIDs := []string{}
	if len(selectedTags) > 0 {
		for _, tag := range selectedTags {
			relatedArgs = append(relatedArgs, tag)
		}
		relatedTags, err := all(r, s.db, `SELECT DISTINCT rt.id FROM bookmarks b
			JOIN bookmark_tags rbt ON rbt.bookmark_id=b.id AND rbt.user_id=b.user_id
			JOIN tags rt ON rt.id=rbt.tag_id AND rt.user_id=b.user_id AND rt.deleted_at IS NULL
			WHERE `+relatedWhere+` AND rt.id NOT IN (`+placeholders(len(selectedTags))+`) ORDER BY rt.id`, relatedArgs...)
		if err != nil {
			return err
		}
		for _, tag := range relatedTags {
			relatedTagIDs = append(relatedTagIDs, str(tag["id"]))
		}
	}
	meta := object{"page_size": size, "count": len(rows), "has_more": more, "next_cursor": nil, "related_tag_ids": relatedTagIDs}
	if more {
		last := rows[len(rows)-1]
		var order *int64
		if boolean(last["is_pinned"]) {
			n := number(last["pin_order"])
			order = &n
		}
		encoded, _ := json.Marshal(bookmarkCursor{str(last["id"]), boolean(last["is_pinned"]), order, last[strings.TrimPrefix(field, "b.")]})
		meta["next_cursor"] = string(encoded)
	}
	return success(w, object{"bookmarks": rows, "meta": meta})
}
func (s *Server) getBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	row, err := s.bookmark(r, s.db, id(r))
	if err != nil {
		return err
	}
	return success(w, object{"bookmark": row})
}
func (s *Server) checkURL(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	raw := r.URL.Query().Get("url")
	if !validURL(raw) {
		return problem(400, "请输入有效的 HTTP/HTTPS URL")
	}
	row, err := one(r, s.db, "SELECT * FROM bookmarks WHERE user_id=? AND url=? AND deleted_at IS NULL", userID(r), raw)
	if errors.Is(err, sql.ErrNoRows) {
		return success(w, object{"exists": false})
	}
	if err != nil {
		return err
	}
	if err = s.decorateBookmarks(r, s.db, []object{row}); err != nil {
		return err
	}
	return success(w, object{"exists": true, "bookmark": row})
}
func bookmarkFields(body object, creating bool) (object, []string, bool, error) {
	fields := object{}
	tags := []string{}
	hasTags := false
	if body == nil {
		return nil, nil, false, problem(400, "缺少书签内容")
	}
	for key, v := range body {
		switch key {
		case "title", "url":
			text, ok := v.(string)
			if !ok || strings.TrimSpace(text) == "" {
				return nil, nil, false, problem(400, key+" 不能为空")
			}
			if key == "url" && !validURL(text) {
				return nil, nil, false, problem(400, "仅支持有效的 HTTP/HTTPS 书签地址")
			}
			if key == "title" && utf8.RuneCountInString(text) > 500 {
				return nil, nil, false, problem(400, "标题不能超过 500 字符")
			}
			fields[key] = strings.TrimSpace(text)
		case "description", "cover_image", "favicon":
			if v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 65536 {
					return nil, nil, false, problem(400, key+" 格式无效")
				}
				if key != "description" && text != "" {
					if hash := bookmarkImageHash(text); hash != "" {
						v = bookmarkImagePrefix + hash
					} else if !validURL(text) {
						return nil, nil, false, problem(400, key+" 地址无效")
					}
				}
			}
			fields[key] = v
		case "is_pinned", "is_archived", "is_public":
			b, ok := v.(bool)
			if !ok {
				return nil, nil, false, problem(400, key+" 必须为布尔值")
			}
			fields[key] = b
		case "snapshot_retention_count":
			if v == nil {
				fields[key] = nil
				continue
			}
			n, ok := v.(float64)
			if !ok || (n != -1 && (n < 1 || n > 100)) || n != float64(int(n)) {
				return nil, nil, false, problem(400, "快照保留数量需为 -1 或 1–100")
			}
			fields[key] = int(n)
		case "tag_ids":
			list, ok := v.([]any)
			if !ok {
				return nil, nil, false, problem(400, "tag_ids 必须为数组")
			}
			for _, item := range list {
				text, ok := item.(string)
				if !ok {
					return nil, nil, false, problem(400, "tag_ids 必须为字符串数组")
				}
				tags = append(tags, text)
			}
			hasTags = true
		default:
			return nil, nil, false, problem(400, "不支持的书签字段: "+key)
		}
	}
	if creating && (fields["title"] == nil || fields["url"] == nil) {
		return nil, nil, false, problem(400, "标题和 URL 不能为空")
	}
	var err error
	tags, err = uniqueIDs(tags)
	return fields, tags, hasTags, err
}
func updateFields(r *http.Request, db executor, table string, fields object, where string, args ...any) (sql.Result, error) {
	if len(fields) == 0 {
		return nil, problem(400, "没有可更新的字段")
	}
	sets := []string{}
	values := []any{}
	for k, v := range fields {
		sets = append(sets, k+"=?")
		values = append(values, v)
	}
	values = append(values, args...)
	return db.ExecContext(r.Context(), "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE "+where, values...)
}
func (s *Server) validateTags(r *http.Request, tx *sql.Tx, tags []string) error {
	if len(tags) == 0 {
		return nil
	}
	args := []any{userID(r)}
	for _, tag := range tags {
		args = append(args, tag)
	}
	var count int
	if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM tags WHERE user_id=? AND deleted_at IS NULL AND id IN ("+placeholders(len(tags))+")", args...).Scan(&count); err != nil {
		return err
	}
	if count != len(tags) {
		return problem(400, "标签不存在或不属于当前账号")
	}
	return nil
}
func (s *Server) setTags(r *http.Request, tx *sql.Tx, bid string, tags []string) error {
	if err := s.validateTags(r, tx, tags); err != nil {
		return err
	}
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM bookmark_tags WHERE bookmark_id=? AND user_id=?", bid, userID(r)); err != nil {
		return err
	}
	for _, tag := range tags {
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO bookmark_tags(bookmark_id,tag_id,user_id) VALUES(?,?,?)", bid, tag, userID(r)); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) createBookmark(w http.ResponseWriter, r *http.Request) error {
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	compatible := strings.HasPrefix(r.URL.Path, "/api/tab/") || strings.HasPrefix(r.URL.Path, "/api/v1/agent/")
	result, err := s.saveBookmark(r, body, compatible)
	if err != nil {
		return err
	}
	if result["already_exists"] == true {
		return success(w, result)
	}
	return created(w, result)
}

// 扩展和工具创建支持重复提交，普通管理接口仍报告重复 URL。
func (s *Server) saveBookmark(r *http.Request, body object, compatible bool) (object, error) {
	if err := permit(r, "bookmarks.create"); err != nil {
		return nil, err
	}
	names, hasNames, err := takeTagNames(body)
	if err != nil {
		return nil, err
	}
	fields, tags, hasTags, err := bookmarkFields(body, true)
	if err != nil {
		return nil, err
	}
	if hasTags || hasNames {
		if err := permit(r, "tags.assign"); err != nil {
			return nil, err
		}
	}
	bid, stamp := auth.ID(), now()
	restored, exists := false, false
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		row, lookupErr := one(r, tx, "SELECT id,deleted_at FROM bookmarks WHERE user_id=? AND url=?", userID(r), fields["url"])
		if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
			return lookupErr
		}
		if lookupErr == nil {
			if !compatible {
				return problem(409, "此 URL 已存在，请检查书签或回收站")
			}
			bid = str(row["id"])
			if row["deleted_at"] == nil {
				exists = true
				return nil
			}
			if err := permit(r, "bookmarks.update"); err != nil {
				return err
			}
			restored = true
			fields["deleted_at"] = nil
			// 重新保存回收站记录时重置创建接口的缺省字段。
			for _, key := range []string{"description", "cover_image", "favicon"} {
				if _, ok := fields[key]; !ok {
					fields[key] = nil
				}
			}
			for _, key := range []string{"is_pinned", "is_archived", "is_public"} {
				if _, ok := fields[key]; !ok {
					fields[key] = false
				}
			}
		} else {
			if _, err := tx.ExecContext(r.Context(), "INSERT INTO bookmarks(id,user_id,title,url,pin_order,created_at,updated_at) VALUES(?,?,?,?,0,?,?)", bid, userID(r), fields["title"], fields["url"], stamp, stamp); err != nil {
				return err
			}
		}
		fields["updated_at"] = stamp
		if _, err := updateFields(r, tx, "bookmarks", fields, "id=? AND user_id=?", bid, userID(r)); err != nil {
			return err
		}
		// 没有明确提交标签时保留原关联，避免绕过 tags.assign 清空标签。
		if !hasTags && !hasNames {
			return nil
		}
		if hasNames {
			tags, err = s.ensureTagNames(r, tx, names)
			if err != nil {
				return err
			}
		}
		return s.setTags(r, tx, bid, tags)
	})
	if err != nil {
		return nil, err
	}
	if !exists {
		s.hostBookmarkImages(r, bid, fields)
	}
	row, err := s.bookmarkWriteResult(r, bid)
	if err != nil {
		return nil, err
	}
	result := object{"bookmark": row}
	if compatible {
		result["restored"] = restored
		result["already_exists"] = exists
	}
	return result, nil
}
func (s *Server) batchBookmarks(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.create"); err != nil {
		return err
	}
	var input struct {
		Bookmarks []object `json:"bookmarks"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if len(input.Bookmarks) < 1 || len(input.Bookmarks) > 100 {
		return problem(400, "每批需为 1–100 个书签")
	}
	succeeded, failed, skipped := 0, 0, 0
	createdRows, failures := []object{}, []object{}
	for index, item := range input.Bookmarks {
		rawURL := str(item["url"])
		result, err := s.saveBookmark(r, item, true)
		if err != nil {
			var e *httpError
			if !errors.As(err, &e) {
				return err
			}
			failed++
			failures = append(failures, object{"index": index, "url": rawURL, "error": e.message})
			continue
		}
		if result["already_exists"] == true {
			skipped++
			continue
		}
		succeeded++
		createdRows = append(createdRows, copyFields(result["bookmark"].(object), "id", "url", "title"))
	}
	return success(w, object{"success": succeeded, "failed": failed, "skipped": skipped, "total": len(input.Bookmarks), "errors": failures, "created_bookmarks": createdRows})
}
func (s *Server) reorderPinned(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	var input struct {
		IDs []string `json:"bookmark_ids"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	ids, err := uniqueIDs(input.IDs)
	if err != nil {
		return err
	}
	if len(ids) == 0 || len(ids) != len(input.IDs) {
		return problem(400, "需要不重复的书签 ID 数组")
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		args := []any{userID(r)}
		for _, bid := range ids {
			args = append(args, bid)
		}
		var count int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM bookmarks WHERE user_id=? AND is_pinned=1 AND deleted_at IS NULL AND id IN ("+placeholders(len(ids))+")", args...).Scan(&count); err != nil {
			return err
		}
		if count != len(ids) {
			return problem(400, "书签不存在、未置顶或不属于当前账号")
		}
		stamp := now()
		for index, bid := range ids {
			if _, err := tx.ExecContext(r.Context(), "UPDATE bookmarks SET pin_order=?,updated_at=? WHERE id=? AND user_id=?", index, stamp, bid, userID(r)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return success(w, object{"message": "已更新置顶顺序", "count": len(ids)})
}
func (s *Server) updateBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	var body object
	if err := decode(w, r, &body); err != nil {
		return err
	}
	names, hasNames, err := takeTagNames(body)
	if err != nil {
		return err
	}
	fields, tags, hasTags, err := bookmarkFields(body, false)
	if err != nil {
		return err
	}
	if hasTags || hasNames {
		if err := permit(r, "tags.assign"); err != nil {
			return err
		}
	}
	fields["updated_at"] = now()
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if _, err := one(r, tx, "SELECT id FROM bookmarks WHERE id=? AND user_id=? AND deleted_at IS NULL", id(r), userID(r)); err != nil {
			return err
		}
		if raw, ok := fields["url"]; ok {
			var count int
			if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM bookmarks WHERE url=? AND user_id=? AND id<>?", raw, userID(r), id(r)).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return problem(409, "此 URL 已存在")
			}
		}
		if _, err := updateFields(r, tx, "bookmarks", fields, "id=? AND user_id=?", id(r), userID(r)); err != nil {
			return err
		}
		if hasNames {
			tags, err = s.ensureTagNames(r, tx, names)
			if err != nil {
				return err
			}
		}
		if hasTags || hasNames {
			return s.setTags(r, tx, id(r), tags)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.hostBookmarkImages(r, id(r), fields)
	row, err := s.bookmarkWriteResult(r, id(r))
	if err != nil {
		return err
	}
	return success(w, object{"bookmark": row})
}
func affected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
func (s *Server) deleteBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.delete"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "UPDATE bookmarks SET deleted_at=?,updated_at=?,click_count=0,last_clicked_at=NULL WHERE user_id=? AND id=? AND deleted_at IS NULL", now(), now(), userID(r), id(r))); err != nil {
		return err
	}
	return empty(w)
}
func (s *Server) restoreBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.update"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "UPDATE bookmarks SET deleted_at=NULL,updated_at=? WHERE user_id=? AND id=? AND deleted_at IS NOT NULL", now(), userID(r), id(r))); err != nil {
		return err
	}
	row, err := s.bookmarkWriteResult(r, id(r))
	if err != nil {
		return err
	}
	return success(w, object{"bookmark": row})
}
func (s *Server) permanentBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.delete"); err != nil {
		return err
	}
	if err := affected(s.db.ExecContext(r.Context(), "DELETE FROM bookmarks WHERE user_id=? AND id=? AND deleted_at IS NOT NULL", userID(r), id(r))); err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return empty(w)
}
func (s *Server) emptyTrash(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.delete"); err != nil {
		return err
	}
	result, err := s.db.ExecContext(r.Context(), "DELETE FROM bookmarks WHERE user_id=? AND deleted_at IS NOT NULL", userID(r))
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"message": "回收站已清空", "count": count})
}

// clickRateLimit 是每个账号每分钟可记录的点击数（书签与标签合计）。
// 正常浏览远低于该值；限制用于防止脚本刷点击写满点击明细表。
const clickRateLimit = 240

func (s *Server) clickBookmark(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	if err := s.rate(r, w, "click:"+userID(r), clickRateLimit, 60); err != nil {
		return err
	}
	stamp := now()
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if err := affected(tx.ExecContext(r.Context(), "UPDATE bookmarks SET click_count=click_count+1,last_clicked_at=? WHERE user_id=? AND id=? AND deleted_at IS NULL", stamp, userID(r), id(r))); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), "INSERT INTO bookmark_click_events(bookmark_id,user_id,clicked_at) VALUES(?,?,?)", id(r), userID(r), stamp)
		return err
	})
	if err != nil {
		return err
	}
	return success(w, object{"message": "已记录访问", "clicked_at": stamp})
}
func (s *Server) bulkBookmarks(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Action string   `json:"action"`
		IDs    []string `json:"bookmark_ids"`
		Add    []string `json:"add_tag_ids"`
		Remove []string `json:"remove_tag_ids"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	permission := "bookmarks.update"
	if body.Action == "delete" {
		permission = "bookmarks.delete"
	}
	if err := permit(r, permission); err != nil {
		return err
	}
	ids, err := uniqueIDs(body.IDs)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return problem(400, "请选择书签")
	}
	add, err := uniqueIDs(body.Add)
	if err != nil {
		return err
	}
	remove, err := uniqueIDs(body.Remove)
	if err != nil {
		return err
	}
	fields := object{"updated_at": now()}
	switch body.Action {
	case "delete":
		fields["deleted_at"] = now()
		fields["click_count"] = 0
		fields["last_clicked_at"] = nil
	case "pin", "unpin":
		fields["is_pinned"] = body.Action == "pin"
	case "archive", "unarchive":
		fields["is_archived"] = body.Action == "archive"
	case "update_tags":
		if err := permit(r, "tags.assign"); err != nil {
			return err
		}
	default:
		return problem(400, "未知批量操作")
	}
	var count int64
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if body.Action == "update_tags" {
			if err := s.validateTags(r, tx, add); err != nil {
				return err
			}
		}
		for _, bid := range ids {
			res, err := updateFields(r, tx, "bookmarks", fields, "id=? AND user_id=? AND deleted_at IS NULL", bid, userID(r))
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			count += n
			if n == 0 || body.Action != "update_tags" {
				continue
			}
			for _, tag := range remove {
				if _, err := tx.ExecContext(r.Context(), "DELETE FROM bookmark_tags WHERE bookmark_id=? AND user_id=? AND tag_id=?", bid, userID(r), tag); err != nil {
					return err
				}
			}
			for _, tag := range add {
				if _, err := tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO bookmark_tags(bookmark_id,tag_id,user_id) VALUES(?,?,?)", bid, tag, userID(r)); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return success(w, object{"success": true, "affected_count": count})
}

// takeTagNames 提取扩展与 Agent 使用的名称标签，普通字段校验仍使用同一套规则。
func takeTagNames(body object) ([]string, bool, error) {
	raw, exists := body["tags"]
	if !exists {
		return nil, false, nil
	}
	delete(body, "tags")
	if _, ok := body["tag_ids"]; ok {
		return nil, false, problem(400, "tags 与 tag_ids 不能同时提供")
	}
	values, ok := raw.([]any)
	if !ok || len(values) > 50 {
		return nil, false, problem(400, "标签必须为最多 50 项的数组")
	}
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		name, ok := value.(string)
		name = strings.TrimSpace(name)
		if !ok || name == "" || len(name) > 150 {
			return nil, false, problem(400, "标签名无效")
		}
		key := strings.ToLower(name)
		if !seen[key] {
			result = append(result, name)
			seen[key] = true
		}
	}
	return result, true, nil
}
func (s *Server) ensureTagNames(r *http.Request, tx *sql.Tx, names []string) ([]string, error) {
	ids := []string{}
	for _, name := range names {
		row, err := one(r, tx, "SELECT id,deleted_at FROM tags WHERE user_id=? AND lower(name)=lower(?)", userID(r), name)
		if err == nil {
			tid := str(row["id"])
			if row["deleted_at"] != nil {
				if err = permit(r, "tags.create"); err != nil {
					return nil, err
				}
				if _, err = tx.ExecContext(r.Context(), "UPDATE tags SET deleted_at=NULL,updated_at=? WHERE id=? AND user_id=?", now(), tid, userID(r)); err != nil {
					return nil, err
				}
			}
			ids = append(ids, tid)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err = permit(r, "tags.create"); err != nil {
			return nil, err
		}
		tid := auth.ID()
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO tags(id,user_id,name,color,created_at,updated_at) VALUES(?,?,?,'#3b82f6',?,?)", tid, userID(r), name, now(), now()); err != nil {
			return nil, err
		}
		ids = append(ids, tid)
	}
	return ids, nil
}
