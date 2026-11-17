package plugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"markvault/internal/plugin"
)

// HTTPImageHosting 装配通用 HTTP 图床与 S3 兼容对象存储。
type HTTPImageHosting struct{}

func (HTTPImageHosting) ValidateCredentials(c plugin.ImageHostingConfig, secret string) error {
	if c.Backend == "s3" {
		_, err := s3Credentials(secret)
		return err
	}
	if len(secret) > 8192 || strings.ContainsAny(secret, "\r\n") {
		return errors.New("图床认证值无效")
	}
	return nil
}

func (HTTPImageHosting) Validate(c plugin.ImageHostingConfig) error {
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(c.Endpoint) > 2048 {
		return errors.New("图床上传地址必须是不含凭据、查询或片段的 HTTPS URL")
	}
	if c.Backend == "s3" {
		return validateS3(c)
	}
	if c.Backend != "http" {
		return errors.New("不支持的图床类型")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(c.FileField) {
		return errors.New("图床文件字段名无效")
	}
	if len(c.URLPath) > 256 || !regexp.MustCompile(`^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$`).MatchString(c.URLPath) {
		return errors.New("图片 URL 路径需为 data.url 或 data.0.url 等点分路径")
	}
	if c.AuthHeader != "" && !strings.EqualFold(c.AuthHeader, "Authorization") && !regexp.MustCompile(`(?i)^x-[a-z0-9-]{1,60}$`).MatchString(c.AuthHeader) {
		return errors.New("认证请求头仅支持 Authorization 或 X-*")
	}
	return validateImagePurposes(c.Purposes)
}

func validateImagePurposes(purposes []string) error {
	if len(purposes) > 5 {
		return errors.New("图片用途过多")
	}
	seen := map[string]bool{}
	for _, p := range purposes {
		if !plugin.Has([]string{"screenshot", "snapshot", "cover", "favicon", "default"}, p) || seen[p] {
			return errors.New("图片用途无效或重复")
		}
		seen[p] = true
	}
	return nil
}

func (h HTTPImageHosting) Upload(ctx context.Context, client *http.Client, c plugin.ImageHostingConfig, secret, mime string, content []byte) (string, error) {
	if err := h.Validate(c); err != nil {
		return "", err
	}
	if c.Backend == "s3" {
		return uploadS3(ctx, client, c, secret, mime, content)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	ext := imageExtension(mime)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="`+c.FileField+`"; filename="image.`+ext+`"`)
	header.Set("Content-Type", mime)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err = part.Write(content); err != nil {
		return "", err
	}
	if err = writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.Endpoint, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	if c.AuthHeader != "" && secret != "" {
		req.Header.Set(c.AuthHeader, secret)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New("图床上传请求失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("图床未接受上传")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	var value any
	if err != nil || len(raw) > 1<<20 || json.Unmarshal(raw, &value) != nil {
		return "", errors.New("图床响应不是有效的 JSON 或超过 1 MiB")
	}
	for _, key := range strings.Split(c.URLPath, ".") {
		switch v := value.(type) {
		case map[string]any:
			value = v[key]
		case []any:
			i, e := strconv.Atoi(key)
			if e != nil || i < 0 || i >= len(v) {
				return "", errors.New("图床响应中找不到图片 URL")
			}
			value = v[i]
		default:
			return "", errors.New("图床响应中找不到图片 URL")
		}
	}
	address, ok := value.(string)
	u, err := url.Parse(address)
	if !ok || len(address) > 8192 || err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return "", errors.New("图床返回的图片地址必须是 HTTPS URL")
	}
	return address, nil
}

func imageExtension(mime string) string {
	ext := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico"}[mime]
	if ext == "" {
		return "img"
	}
	return ext
}

// ReadRequest 只对配置中的私有 S3 对象签名，公开图片不携带任何凭据。
func (h HTTPImageHosting) ReadRequest(ctx context.Context, c plugin.ImageHostingConfig, secret, address string) (*http.Request, error) {
	if err := h.Validate(c); err != nil {
		return nil, err
	}
	if c.Backend != "s3" || c.PublicURL != "" {
		return http.NewRequestWithContext(ctx, "GET", address, nil)
	}
	return readS3Request(ctx, c, secret, address)
}
