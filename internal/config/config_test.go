package config

import (
	"testing"
	"time"
)

func TestTokenLifetimeDefaultsAndOverrides(t *testing.T) {
	for _, key := range []string{"JWT_ACCESS_TOKEN_EXPIRES_IN", "JWT_REFRESH_TOKEN_EXPIRES_IN", "STORAGE_MAX_TOTAL_BYTES", "R2_MAX_TOTAL_BYTES", "AI_CHAT_MAX_TOOL_ROUNDS", "CORS_ALLOWED_ORIGINS"} {
		t.Setenv(key, "")
	}
	cfg, err := Load()
	if err != nil || cfg.AccessTTL != 15*time.Minute || cfg.RefreshTTL != 30*24*time.Hour {
		t.Fatalf("默认令牌有效期错误: %s %s %v", cfg.AccessTTL, cfg.RefreshTTL, err)
	}
	t.Setenv("JWT_ACCESS_TOKEN_EXPIRES_IN", "1h")
	t.Setenv("JWT_REFRESH_TOKEN_EXPIRES_IN", "7d")
	cfg, err = Load()
	if err != nil || cfg.AccessTTL != time.Hour || cfg.RefreshTTL != 7*24*time.Hour {
		t.Fatalf("自定义令牌有效期未生效: %s %s %v", cfg.AccessTTL, cfg.RefreshTTL, err)
	}
}
