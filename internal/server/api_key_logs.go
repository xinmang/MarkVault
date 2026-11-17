package server

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

func (s *Server) logAPIKey(r *http.Request, p *principal, status int) {
	// 客户端取消后仍记录已经完成的请求，同时限制日志写入的等待时间。
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
	defer cancel()
	err := transaction(ctx, s.db, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO api_key_logs(api_key_id,user_id,endpoint,method,status,ip) VALUES(?,?,?,?,?,?)`, p.APIKeyID, p.UserID, r.URL.Path, r.Method, status, s.clientIP(r)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM api_key_logs WHERE api_key_id=? AND id NOT IN (SELECT id FROM api_key_logs WHERE api_key_id=? ORDER BY id DESC LIMIT 100)`, p.APIKeyID, p.APIKeyID)
		return err
	})
	if err != nil {
		s.log.Warn("记录 API Key 请求日志失败", "error", err)
	}
}
