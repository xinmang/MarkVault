package server

import (
	"net/http"
)

func (s *Server) registrationEnabled(r *http.Request, db executor) (bool, error) {
	var enabled bool
	err := db.QueryRowContext(r.Context(), "SELECT registration_enabled FROM auth_settings WHERE id=1").Scan(&enabled)
	return enabled && s.config.AllowRegistration, err
}

func (s *Server) authOptions(w http.ResponseWriter, r *http.Request) error {
	enabled, err := s.registrationEnabled(r, s.db)
	if err != nil {
		return err
	}
	available, err := s.passkeyAvailable(r, s.db, "")
	if err != nil {
		return err
	}
	_, originErr := passkeyOrigin(r, false)
	w.Header().Set("Cache-Control", "no-store")
	return success(w, object{"registration_enabled": enabled, "passkey_enabled": available && originErr == nil})
}

func (s *Server) authSettings(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requireSiteAdmin(r); err != nil {
		return err
	}
	if r.Method == "PUT" {
		var body struct {
			Enabled *bool `json:"registration_enabled"`
		}
		if err := decode(w, r, &body); err != nil {
			return err
		}
		if body.Enabled == nil {
			return problem(400, "请选择是否允许用户注册")
		}
		if *body.Enabled && !s.config.AllowRegistration {
			return problem(409, "部署配置已禁止注册，请先启用 ALLOW_REGISTRATION")
		}
		if _, err := s.db.ExecContext(r.Context(), "UPDATE auth_settings SET registration_enabled=? WHERE id=1", *body.Enabled); err != nil {
			return err
		}
	}
	enabled, err := s.registrationEnabled(r, s.db)
	if err != nil {
		return err
	}
	return success(w, object{"registration_enabled": enabled, "locked": !s.config.AllowRegistration})
}
