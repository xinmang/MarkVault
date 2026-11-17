package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const passwordIterations = 600000

// HashPassword 提高计算成本，同时保留旧版密码的盐、摘要和编码格式。
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2_sha256:%d:%s", passwordIterations, base64.StdEncoding.EncodeToString(append(salt, hash...))), nil
}

func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, ":")
	if len(parts) != 3 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 1 || iterations > 2000000 {
		return false
	}
	data, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil || len(data) != 48 {
		return false
	}
	hash, err := pbkdf2.Key(sha256.New, password, data[:16], iterations, 32)
	return err == nil && subtle.ConstantTimeCompare(hash, data[16:]) == 1
}

// PasswordNeedsRehash 仅在密码验证成功后调用，不降低已有哈希的计算成本。
func PasswordNeedsRehash(encoded string) bool {
	parts := strings.Split(encoded, ":")
	if len(parts) != 3 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	return err == nil && iterations > 0 && iterations < passwordIterations
}

// DummyPasswordHash 为不存在的账号提供与新密码相同的验证成本。
func DummyPasswordHash() string {
	return fmt.Sprintf("pbkdf2_sha256:%d:%s", passwordIterations, base64.StdEncoding.EncodeToString(make([]byte, 48)))
}

func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.StdEncoding.EncodeToString(sum[:])
}
func HashAPIKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("系统安全随机源不可用")
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type Claims struct {
	Version   int64  `json:"auth_version,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	jwt.RegisteredClaims
}

func Sign(userID, secret string, ttl time.Duration, version ...int64) (string, error) {
	now := time.Now()
	claims := Claims{SessionID: ID(), RegisteredClaims: jwt.RegisteredClaims{Subject: userID, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl))}}
	if len(version) > 0 {
		claims.Version = version[0]
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}
func Verify(token, secret string) (*Claims, error) {
	claims := new(Claims)
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) { return []byte(secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !parsed.Valid || claims.Subject == "" {
		return nil, errors.New("无效或过期的访问令牌")
	}
	return claims, nil
}

func Encrypt(value, secret string) (string, error) {
	aead, err := newAEAD(secret)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, nonce, []byte(value), nil)
	return "v1." + base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(sealed), nil
}
func Decrypt(value, secret string) (string, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return "", errors.New("不支持的密文格式")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	sealed, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", err
	}
	aead, err := newAEAD(secret)
	if err != nil {
		return "", err
	}
	if len(nonce) != aead.NonceSize() {
		return "", errors.New("无效的密文随机量")
	}
	raw, err := aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", errors.New("无法解密，请确认实例密钥一致")
	}
	return string(raw), nil
}
func newAEAD(secret string) (cipher.AEAD, error) {
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
