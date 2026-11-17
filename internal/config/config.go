package config

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config 仅包含与部署有关的配置，不向业务层暴露平台绑定。
type Config struct {
	DenoPath             string
	PluginPrivateTargets string
	Address              string
	DataDir              string
	WebDir               string
	JWTSecret            string
	EncryptionKey        string
	AccessTTL            time.Duration
	RefreshTTL           time.Duration
	AllowRegistration    bool
	AllowedOrigins       []string
	StorageLimit         int64
	AllowPrivateAI       bool
	AIChatMaxRounds      int
	// TrustedProxies 为可信反向代理的地址段；只有来自这些地址的请求才读取 X-Forwarded-For。
	TrustedProxies []netip.Prefix
	Development    bool
}

func Load() (Config, error) {
	c := Config{
		DenoPath:             os.Getenv("MARKVAULT_DENO_PATH"),
		PluginPrivateTargets: os.Getenv("MARKVAULT_PLUGIN_PRIVATE_TARGETS"),
		Address:              env("MARKVAULT_ADDR", ":"+env("PORT", "8787")),
		DataDir:              env("MARKVAULT_DATA_DIR", ".data/go"),
		WebDir:               env("MARKVAULT_WEB_DIR", "dist"),
		JWTSecret:            os.Getenv("JWT_SECRET"), EncryptionKey: os.Getenv("ENCRYPTION_KEY"),
		AllowRegistration: env("ALLOW_REGISTRATION", "true") == "true",
		AllowPrivateAI:    os.Getenv("AI_ALLOW_PRIVATE_ENDPOINTS") == "true",
		Development:       os.Getenv("ENVIRONMENT") == "development",
	}
	var err error
	if c.TrustedProxies, err = ParseTrustedProxies(os.Getenv("MARKVAULT_TRUSTED_PROXIES")); err != nil {
		return c, err
	}
	if c.DataDir, err = filepath.Abs(c.DataDir); err != nil {
		return c, err
	}
	if c.AccessTTL, err = ParseDuration(env("JWT_ACCESS_TOKEN_EXPIRES_IN", "15m")); err != nil {
		return c, fmt.Errorf("访问令牌有效期: %w", err)
	}
	if c.RefreshTTL, err = ParseDuration(env("JWT_REFRESH_TOKEN_EXPIRES_IN", "30d")); err != nil {
		return c, fmt.Errorf("刷新令牌有效期: %w", err)
	}
	c.StorageLimit, err = strconv.ParseInt(env("STORAGE_MAX_TOTAL_BYTES", env("R2_MAX_TOTAL_BYTES", "7516192768")), 10, 64)
	if err != nil || c.StorageLimit < 0 {
		return c, errors.New("存储配额必须为非负整数")
	}
	c.AIChatMaxRounds, err = strconv.Atoi(env("AI_CHAT_MAX_TOOL_ROUNDS", "6"))
	if err != nil || c.AIChatMaxRounds < 1 || c.AIChatMaxRounds > 20 {
		return c, errors.New("AI_CHAT_MAX_TOOL_ROUNDS 必须在 1 到 20 之间")
	}
	for _, origin := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "chrome-extension" && u.Scheme != "moz-extension") || strings.Contains(origin, "*") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return c, errors.New("跨域白名单必须包含完整来源，不能包含路径或通配符")
		}
		c.AllowedOrigins = append(c.AllowedOrigins, strings.TrimSuffix(origin, "/"))
	}
	return c, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// ParseTrustedProxies 解析逗号分隔的 IP 或 CIDR；单个地址视为 /32 或 /128。
// 不接受 0.0.0.0/0 这类全网段，避免误配置后任何客户端都能伪造来源地址。
func ParseTrustedProxies(raw string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(item)
		if err != nil {
			address, addressErr := netip.ParseAddr(item)
			if addressErr != nil {
				return nil, fmt.Errorf("MARKVAULT_TRUSTED_PROXIES 包含无效地址: %s", item)
			}
			address = address.Unmap()
			prefix = netip.PrefixFrom(address, address.BitLen())
		}
		if prefix.Bits() == 0 {
			return nil, errors.New("MARKVAULT_TRUSTED_PROXIES 不能信任全部地址")
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func ParseDuration(value string) (time.Duration, error) {
	if strings.HasSuffix(value, "d") {
		days, err := strconv.ParseInt(strings.TrimSuffix(value, "d"), 10, 64)
		if err != nil || days < 1 || days > 36500 {
			return 0, errors.New("无效的天数")
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil || d <= 0 || d > 36500*24*time.Hour {
		return 0, errors.New("无效的有效期")
	}
	return d, nil
}

// PrepareSecrets 保留原实例密钥；新实例使用独占创建，避免并发启动覆盖密钥。
func (c *Config) PrepareSecrets() error {
	dir := filepath.Join(c.DataDir, "config")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	path := filepath.Join(dir, "runtime.env")
	saved := map[string]string{}
	f, err := os.Open(path)
	if err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, value, ok := strings.Cut(line, "=")
			if ok {
				saved[strings.TrimSpace(key)] = strings.TrimSpace(value)
			}
		}
		scanErr := scanner.Err()
		f.Close()
		if scanErr != nil {
			return scanErr
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if c.JWTSecret == "" {
		c.JWTSecret = saved["JWT_SECRET"]
	}
	if c.EncryptionKey == "" {
		c.EncryptionKey = saved["ENCRYPTION_KEY"]
	}
	if err == nil && (c.JWTSecret == "" || c.EncryptionKey == "") {
		return errors.New("已有密钥文件不完整，请恢复原密钥，不要自动重新生成")
	}
	for _, secret := range []*string{&c.JWTSecret, &c.EncryptionKey} {
		if *secret == "" {
			b := make([]byte, 48)
			if _, err := rand.Read(b); err != nil {
				return err
			}
			*secret = hex.EncodeToString(b)
		}
		if len(*secret) < 48 || strings.ContainsAny(*secret, "\r\n") {
			return errors.New("实例密钥至少需要 48 个字符且不能包含换行")
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return fmt.Errorf("创建密钥文件失败，请确认没有并行启动: %w", err)
		}
		_, writeErr := fmt.Fprintf(out, "JWT_SECRET=%s\nENCRYPTION_KEY=%s\n", c.JWTSecret, c.EncryptionKey)
		syncErr := out.Sync()
		closeErr := out.Close()
		return errors.Join(writeErr, syncErr, closeErr)
	}
	return nil
}
