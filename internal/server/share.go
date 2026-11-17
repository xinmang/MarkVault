package server

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
)

func shareOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
func (s *Server) groupShare(w http.ResponseWriter, r *http.Request) error {
	permission := "tab_groups.read"
	if r.Method != "GET" {
		permission = "tab_groups.update"
	}
	if err := permit(r, permission); err != nil {
		return err
	}
	if _, err := one(r, s.db, "SELECT id FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0", id(r), userID(r)); err != nil {
		return err
	}
	if r.Method == "DELETE" {
		if _, err := s.db.ExecContext(r.Context(), "DELETE FROM shares WHERE group_id=? AND user_id=?", id(r), userID(r)); err != nil {
			return err
		}
		return empty(w)
	}
	if r.Method == "POST" {
		var body struct {
			Public bool `json:"is_public"`
			Days   *int `json:"expires_in_days"`
		}
		if err := decode(w, r, &body); err != nil {
			return err
		}
		var expires any
		if body.Days != nil {
			if *body.Days < 1 || *body.Days > 36500 {
				return problem(400, "分享有效期需为 1–36500 天")
			}
			expires = time.Now().UTC().Add(time.Duration(*body.Days) * 24 * time.Hour).Format(time.RFC3339Nano)
		}
		err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
			res, err := tx.ExecContext(r.Context(), "UPDATE shares SET is_public=?,expires_at=? WHERE group_id=? AND user_id=?", body.Public, expires, id(r), userID(r))
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if n == 0 {
				_, err = tx.ExecContext(r.Context(), "INSERT INTO shares(id,group_id,user_id,share_token,is_public,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", auth.ID(), id(r), userID(r), auth.ID(), body.Public, expires, now())
			}
			return err
		})
		if err != nil {
			return err
		}
	}
	row, err := one(r, s.db, "SELECT * FROM shares WHERE group_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1", id(r), userID(r))
	if err != nil {
		return err
	}
	bools(row, "is_public")
	return success(w, object{"share": row, "share_token": row["share_token"], "is_public": row["is_public"], "expires_at": row["expires_at"], "created_at": row["created_at"], "share_url": shareOrigin(r) + "/share/" + str(row["share_token"])})
}
func (s *Server) publicGroup(w http.ResponseWriter, r *http.Request) error {
	var payload object
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		share, err := one(r, tx, "SELECT s.* FROM shares s JOIN tab_groups g ON g.id=s.group_id AND g.user_id=s.user_id WHERE s.share_token=? AND s.is_public=1 AND g.is_deleted=0 AND (s.expires_at IS NULL OR julianday(s.expires_at)>julianday('now'))", chi.URLParam(r, "token"))
		if err != nil {
			return err
		}
		row, err := one(r, tx, "SELECT * FROM tab_groups WHERE id=? AND user_id=? AND is_deleted=0", share["group_id"], share["user_id"])
		if err != nil {
			return err
		}
		if err = s.groups(r, tx, []object{row}); err != nil {
			return err
		}
		// 分享链接是匿名访问，不输出所有者账号 ID。
		delete(row, "user_id")
		if _, err := tx.ExecContext(r.Context(), "UPDATE shares SET view_count=view_count+1 WHERE id=?", share["id"]); err != nil {
			return err
		}
		payload = object{"tab_group": row, "share_info": object{"view_count": number(share["view_count"]) + 1, "created_at": share["created_at"], "expires_at": share["expires_at"]}}
		return nil
	})
	if err != nil {
		return err
	}
	return success(w, payload)
}

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,49}$`)

// publicBookmarkColumns 是公开书签接口的字段白名单；click_count 供热度与收藏卡效果使用。
const publicBookmarkColumns = "id,title,url,description,cover_image,favicon,is_pinned,is_archived,is_public,click_count,created_at,updated_at"

func (s *Server) shareSettings(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if r.Method == "PUT" {
		var body object
		if err := decode(w, r, &body); err != nil {
			return err
		}
		fields := object{"updated_at": now()}
		for k, v := range body {
			switch k {
			case "enabled":
				b, ok := v.(bool)
				if !ok {
					return problem(400, "enabled 必须是布尔值")
				}
				fields["public_share_enabled"] = b
			case "slug":
				if v != nil {
					text, ok := v.(string)
					if !ok || !slugPattern.MatchString(strings.ToLower(text)) {
						return problem(400, "分享别名需为 3–50 位小写字母、数字、下划线或短横线")
					}
					v = strings.ToLower(text)
				}
				fields["public_slug"] = v
			case "title", "description":
				max := 500
				if k == "title" {
					max = 200
				}
				if v != nil {
					text, ok := v.(string)
					if !ok || len([]rune(text)) > max {
						return problem(400, "分享页面文字过长")
					}
				}
				fields["public_page_"+k] = v
			default:
				return problem(400, "未知分享设置字段")
			}
		}
		err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
			row, err := one(r, tx, "SELECT public_slug,public_share_enabled FROM users WHERE id=?", userID(r))
			if err != nil {
				return err
			}
			slug := row["public_slug"]
			if v, ok := fields["public_slug"]; ok {
				slug = v
			}
			enabled := boolean(row["public_share_enabled"])
			if v, ok := fields["public_share_enabled"]; ok {
				enabled = boolean(v)
			}
			if enabled && slug == nil {
				slug = auth.ID()
				fields["public_slug"] = slug
			}
			if slug != nil {
				var n int
				if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE lower(public_slug)=lower(?) AND id<>?", slug, userID(r)).Scan(&n); err != nil {
					return err
				}
				if n > 0 {
					return problem(409, "分享别名已被使用")
				}
			}
			_, err = updateFields(r, tx, "users", fields, "id=?", userID(r))
			return err
		})
		if err != nil {
			return err
		}
	}
	row, err := one(r, s.db, "SELECT public_share_enabled AS enabled,public_slug AS slug,public_page_title AS title,public_page_description AS description FROM users WHERE id=?", userID(r))
	if err != nil {
		return err
	}
	bools(row, "enabled")
	return success(w, object{"share": row})
}
func (s *Server) publicBookmarks(w http.ResponseWriter, r *http.Request) error {
	user, err := one(r, s.db, "SELECT id,username,public_slug AS slug,public_page_title AS title,public_page_description AS description FROM users WHERE lower(public_slug)=lower(?) AND public_share_enabled=1", chi.URLParam(r, "slug"))
	if err != nil {
		return err
	}
	r = r.WithContext(context.WithValue(r.Context(), authContextKey{}, &principal{UserID: str(user["id"])}))
	size, offset, err := page(r)
	if err != nil {
		return err
	}
	paginated := r.URL.Query().Has("page_size") || r.URL.Query().Has("page_cursor")
	// 公开页只输出展示所需字段：不暴露账号 ID、最近访问时间、快照与排序等内部数据。
	query := "SELECT " + publicBookmarkColumns + " FROM bookmarks WHERE user_id=? AND is_public=1 AND deleted_at IS NULL ORDER BY is_pinned DESC,COALESCE(pin_order,0),created_at DESC,id DESC"
	args := []any{userID(r)}
	if paginated {
		query += " LIMIT ? OFFSET ?"
		args = append(args, size+1, offset)
	}
	rows, err := all(r, s.db, query, args...)
	if err != nil {
		return err
	}
	if err = s.decorateBookmarkData(r, s.db, rows); err != nil {
		return err
	}
	s.signBookmarkImages(userID(r), rows, "public")
	if err = s.attachScreenshots(r, s.db, userID(r), rows, "public"); err != nil {
		return err
	}
	payload := pageResult("bookmarks", rows, size, offset)
	if !paginated {
		payload["bookmarks"] = rows
		delete(payload, "meta")
		payload["generated_at"] = now()
	}
	delete(user, "id")
	payload["profile"] = user
	prefs, err := one(r, s.db, "SELECT * FROM user_preferences WHERE user_id=?", userID(r))
	if err != nil {
		return err
	}
	bools(prefs, preferenceBools...)
	display := object{}
	for key, value := range prefs {
		// 公开页沿用主人的展示与动效偏好；访客系统开启“减少动态效果”时前端仍会降级。
		if strings.HasPrefix(key, "experimental_") || strings.HasPrefix(key, "motion_") || contains([]string{"view_mode", "tag_layout", "show_tag_icons", "tag_sort_by", "sort_by", "default_bookmark_icon"}, key) {
			display[key] = value
		}
	}
	payload["preferences"] = display
	tags, err := all(r, s.db, `SELECT t.id,t.name,t.color,t.icon,t.click_count,COUNT(b.id) AS bookmark_count FROM tags t JOIN bookmark_tags bt ON bt.tag_id=t.id AND bt.user_id=t.user_id JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=t.user_id WHERE t.user_id=? AND t.deleted_at IS NULL AND b.deleted_at IS NULL AND b.is_public=1 GROUP BY t.id ORDER BY bookmark_count DESC,lower(t.name)`, userID(r))
	if err != nil {
		return err
	}
	payload["tags"] = tags
	return success(w, payload)
}
func (s *Server) storageQuota(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var used int64
	if err := s.db.QueryRowContext(r.Context(), storageUsedQuery).Scan(&used); err != nil {
		return err
	}
	var limit any = s.config.StorageLimit
	if s.config.StorageLimit == 0 {
		limit = nil
	}
	return success(w, object{"quota": object{"used_bytes": used, "limit_bytes": limit, "unlimited": s.config.StorageLimit == 0}})
}
