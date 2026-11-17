package server

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
)

func (s *Server) publicBookmarkClick(w http.ResponseWriter, r *http.Request) error {
	return s.publicClick(w, r, false)
}

func (s *Server) publicTagClick(w http.ResponseWriter, r *http.Request) error {
	return s.publicClick(w, r, true)
}

// 公开点击不依赖访客登录身份，归属始终由仍然启用的分享别名决定。
func (s *Server) publicClick(w http.ResponseWriter, r *http.Request, tag bool) error {
	slug := chi.URLParam(r, "slug")
	if !slugPattern.MatchString(strings.ToLower(slug)) || len(id(r)) > 128 {
		return sql.ErrNoRows
	}
	// 两类点击共用访客 IP 限流，与分享者的登录点击额度分开。
	if err := s.rate(r, w, "public-click:"+auth.HashToken(s.clientIP(r)), clickRateLimit, 60); err != nil {
		return err
	}
	stamp := now()
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		owner, err := one(r, tx, "SELECT id FROM users WHERE lower(public_slug)=lower(?) AND public_share_enabled=1", slug)
		if err != nil {
			return err
		}
		uid := str(owner["id"])
		if tag {
			// 只允许点击公开页可见的标签，私有书签独占的标签不接受匿名写入。
			if err := affected(tx.ExecContext(r.Context(), `UPDATE tags SET click_count=click_count+1,last_clicked_at=?
				WHERE id=? AND user_id=? AND deleted_at IS NULL AND EXISTS (
					SELECT 1 FROM bookmark_tags bt JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=bt.user_id
					WHERE bt.tag_id=tags.id AND bt.user_id=tags.user_id AND b.is_public=1 AND b.deleted_at IS NULL
				)`, stamp, id(r), uid)); err != nil {
				return err
			}
			_, err = tx.ExecContext(r.Context(), "INSERT INTO tag_click_events(tag_id,user_id,clicked_at) VALUES(?,?,?)", id(r), uid, stamp)
		} else {
			if err := affected(tx.ExecContext(r.Context(), "UPDATE bookmarks SET click_count=click_count+1,last_clicked_at=? WHERE id=? AND user_id=? AND is_public=1 AND deleted_at IS NULL", stamp, id(r), uid)); err != nil {
				return err
			}
			_, err = tx.ExecContext(r.Context(), "INSERT INTO bookmark_click_events(bookmark_id,user_id,clicked_at) VALUES(?,?,?)", id(r), uid, stamp)
		}
		return err
	})
	if err != nil {
		return err
	}
	// 匿名响应不返回账号 ID、最近访问时间或资源详情。
	return empty(w)
}
