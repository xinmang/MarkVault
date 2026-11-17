package plugins

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"

	"markvault/internal/plugin"
)

func validateS3(c plugin.ImageHostingConfig) error {
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("S3 端点须为不含桶名、路径、查询或凭据的 HTTPS 来源")
	}
	if !regexp.MustCompile("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$").MatchString(c.Bucket) || strings.Contains(c.Bucket, "..") || strings.Contains(c.Bucket, ".-") || strings.Contains(c.Bucket, "-.") {
		return errors.New("S3 桶名无效")
	}
	if _, err := netip.ParseAddr(c.Bucket); err == nil {
		return errors.New("S3 桶名不能是 IP 地址")
	}
	if !regexp.MustCompile("^[a-z0-9][a-z0-9-]{0,63}$").MatchString(c.Region) {
		return errors.New("S3 区域无效；R2 使用 auto，MinIO 通常使用 us-east-1")
	}
	if len(c.Prefix) > 256 || strings.HasPrefix(c.Prefix, "/") || strings.HasSuffix(c.Prefix, "/") {
		return errors.New("对象前缀不能以斜杠开头或结尾")
	}
	if c.Prefix != "" {
		for _, segment := range strings.Split(c.Prefix, "/") {
			if !regexp.MustCompile("^[a-zA-Z0-9_-]+$").MatchString(segment) {
				return errors.New("对象前缀仅支持字母、数字、下划线、短横线和分隔斜杠")
			}
		}
	}
	if !c.PathStyle {
		if _, err := netip.ParseAddr(u.Hostname()); err == nil {
			return errors.New("IP 端点必须使用路径式访问")
		}
		if strings.Contains(c.Bucket, ".") {
			return errors.New("含点桶名请使用路径式访问，以兼容 HTTPS 证书")
		}
	}
	if c.PublicURL != "" {
		p, e := url.Parse(c.PublicURL)
		if e != nil || p.Scheme != "https" || p.Hostname() == "" || p.User != nil || p.RawQuery != "" || p.Fragment != "" || len(c.PublicURL) > 2048 || strings.ContainsAny(p.Path, "\\\r\n") {
			return errors.New("公开图片地址须为不含查询或凭据的 HTTPS 基础地址")
		}
	}
	return validateImagePurposes(c.Purposes)
}

func s3Credentials(raw string) (plugin.S3Credentials, error) {
	var c plugin.S3Credentials
	if json.Unmarshal([]byte(raw), &c) != nil || !regexp.MustCompile("^[a-zA-Z0-9_-]{3,128}$").MatchString(c.AccessKeyID) || len(c.SecretAccessKey) < 8 || len(c.SecretAccessKey) > 1024 || strings.ContainsAny(c.SecretAccessKey, "\r\n\x00") {
		return c, errors.New("请配置有效的 S3 Access Key ID 和 Secret Access Key")
	}
	return c, nil
}

func s3ObjectURL(c plugin.ImageHostingConfig, key string) (*url.URL, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil {
		return nil, err
	}
	if c.PathStyle {
		u.Path = "/" + c.Bucket + "/" + key
	} else {
		u.Host = c.Bucket + "." + u.Host
		u.Path = "/" + key
	}
	u.RawPath = ""
	return u, nil
}

func uploadS3(ctx context.Context, client *http.Client, c plugin.ImageHostingConfig, secret, mime string, content []byte) (string, error) {
	credentials, err := s3Credentials(secret)
	if err != nil {
		return "", err
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		return "", err
	}
	key := hex.EncodeToString(random) + "." + imageExtension(mime)
	if c.Prefix != "" {
		key = c.Prefix + "/" + key
	}
	u, err := s3ObjectURL(c, key)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "PUT", u.String(), bytes.NewReader(content))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mime)
	signS3(req, credentials, c.Region, content, time.Now().UTC())
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New("S3 上传请求失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("S3 未接受上传（HTTP %d）", resp.StatusCode)
	}
	if c.PublicURL != "" {
		public, _ := url.Parse(c.PublicURL)
		public.Path = strings.TrimRight(public.Path, "/") + "/" + key
		public.RawPath = ""
		return public.String(), nil
	}
	return u.String(), nil
}

func readS3Request(ctx context.Context, c plugin.ImageHostingConfig, secret, address string) (*http.Request, error) {
	credentials, err := s3Credentials(secret)
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(address)
	if err != nil {
		return nil, err
	}
	base, err := s3ObjectURL(c, "")
	if err != nil {
		return nil, err
	}
	prefix := base.Path
	if c.Prefix != "" {
		prefix += c.Prefix + "/"
	}
	if u.Scheme != base.Scheme || u.Host != base.Host || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, prefix) {
		return nil, errors.New("S3 图片不属于保存时的桶与前缀")
	}
	name := strings.TrimPrefix(u.Path, prefix)
	if !regexp.MustCompile("^[a-f0-9]{32}\\.[a-z]+$").MatchString(name) {
		return nil, errors.New("S3 对象标识无效")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	signS3(req, credentials, c.Region, nil, time.Now().UTC())
	return req, nil
}

// signS3 使用 AWS Signature V4 头部签名；不生成会过期的持久化预签名 URL。
func signS3(req *http.Request, credentials plugin.S3Credentials, region string, payload []byte, stamp time.Time) {
	hash := sha256.Sum256(payload)
	digest := hex.EncodeToString(hash[:])
	date := stamp.UTC().Format("20060102")
	timestamp := stamp.UTC().Format("20060102T150405Z")
	req.Header.Set("X-Amz-Date", timestamp)
	req.Header.Set("X-Amz-Content-Sha256", digest)
	signed := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := "host:" + req.URL.Host + "\nx-amz-content-sha256:" + digest + "\nx-amz-date:" + timestamp + "\n"
	canonical := req.Method + "\n" + awsURI(req.URL.Path) + "\n" + strings.ReplaceAll(req.URL.Query().Encode(), "+", "%20") + "\n" + canonicalHeaders + "\n" + signed + "\n" + digest
	canonicalHash := sha256.Sum256([]byte(canonical))
	scope := date + "/" + region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])
	key := s3HMAC([]byte("AWS4"+credentials.SecretAccessKey), date)
	key = s3HMAC(key, region)
	key = s3HMAC(key, "s3")
	key = s3HMAC(key, "aws4_request")
	signature := hex.EncodeToString(s3HMAC(key, toSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+credentials.AccessKeyID+"/"+scope+", SignedHeaders="+signed+", Signature="+signature)
}

func s3HMAC(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(value))
	return mac.Sum(nil)
}

// AWS URI 编码保留路径分隔符，其余非 unreserved 字节按大写十六进制编码。
func awsURI(path string) string {
	if path == "" {
		return "/"
	}
	const digits = "0123456789ABCDEF"
	var out strings.Builder
	for i := 0; i < len(path); i++ {
		b := path[i]
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("-._~/", rune(b)) {
			out.WriteByte(b)
		} else {
			out.WriteByte('%')
			out.WriteByte(digits[b>>4])
			out.WriteByte(digits[b&15])
		}
	}
	return out.String()
}
