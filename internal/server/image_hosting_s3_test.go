package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"markvault/internal/plugin"
)

type s3TestTransport func(*http.Request) (*http.Response, error)

func (f s3TestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// 从接收端按签名声明重建规范请求，防止只检查签名字段存在。
func verifyS3Upload(r *http.Request, content []byte, secrets map[string]string) bool {
	prefix := "AWS4-HMAC-SHA256 "
	authorization := r.Header.Get("Authorization")
	if !strings.HasPrefix(authorization, prefix) {
		return false
	}
	values := map[string]string{}
	for _, part := range strings.Split(strings.TrimPrefix(authorization, prefix), ", ") {
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			return false
		}
		values[key] = value
	}
	credential := strings.Split(values["Credential"], "/")
	if len(credential) != 5 || credential[3] != "s3" || credential[4] != "aws4_request" {
		return false
	}
	secret, ok := secrets[credential[0]]
	if !ok {
		return false
	}
	hash := sha256.Sum256(content)
	digest := hex.EncodeToString(hash[:])
	if r.Header.Get("X-Amz-Content-Sha256") != digest {
		return false
	}
	var headers strings.Builder
	for _, name := range strings.Split(values["SignedHeaders"], ";") {
		value := r.Header.Get(name)
		if name == "host" {
			value = r.URL.Host
		}
		if value == "" {
			return false
		}
		headers.WriteString(name + ":" + value + "\n")
	}
	canonical := strings.Join([]string{r.Method, r.URL.EscapedPath(), r.URL.RawQuery, headers.String(), values["SignedHeaders"], digest}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonical))
	message := strings.Join([]string{"AWS4-HMAC-SHA256", r.Header.Get("X-Amz-Date"), strings.Join(credential[1:], "/"), hex.EncodeToString(canonicalHash[:])}, "\n")
	key := []byte("AWS4" + secret)
	for _, part := range credential[1:] {
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(part))
		key = mac.Sum(nil)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(message))
	return hmac.Equal([]byte(values["Signature"]), []byte(hex.EncodeToString(mac.Sum(nil))))
}

func TestImageHostingS3PrivateAndPublic(t *testing.T) {
	content, encoded := pngData(t, 3, 2)
	files := map[string][]byte{}
	calls, publicReads, deny := 0, 0, false
	// 进程内传输无需监听端口，完整验证应用请求和响应。
	client := &http.Client{Transport: s3TestTransport(func(r *http.Request) (*http.Response, error) {
		var raw []byte
		if r.Body != nil {
			raw, _ = io.ReadAll(r.Body)
		}
		calls++
		response := httptest.NewRecorder()
		if strings.HasPrefix(r.URL.Path, "/public/") {
			publicReads++
			if r.Header.Get("Authorization") != "" {
				t.Error("公开 CDN 收到了签名凭据")
			}
		} else if !verifyS3Upload(r, raw, map[string]string{"TESTACCESS": "test-private-key-value", "NEWACCESS": "test-updated-key-value"}) {
			t.Error("S3 请求签名无效")
			response.WriteHeader(403)
			return response.Result(), nil
		}
		if deny {
			response.WriteHeader(403)
			return response.Result(), nil
		}
		if r.Method == "PUT" {
			files[r.URL.Path] = raw
			response.WriteHeader(200)
			return response.Result(), nil
		}
		path := strings.Replace(r.URL.Path, "/public/", "/image-bucket/", 1)
		image, ok := files[path]
		if !ok {
			response.WriteHeader(404)
			return response.Result(), nil
		}
		response.Header().Set("Content-Type", "image/png")
		_, _ = response.Write(image)
		return response.Result(), nil
	})}
	f := setup(t)
	s := f.handler.(*Server)
	s.imageClient = func(string) *http.Client { return client }
	token, login := f.account("s3_owner")
	uid := str(login["user"].(map[string]any)["id"])
	cfg := object{"backend": "s3", "endpoint": "https://storage.example.com", "bucket": "image-bucket", "region": "auto", "prefix": "markvault", "pathStyle": true, "purposes": []string{"screenshot"}}
	save := func(extra object, status int) {
		t.Helper()
		input := object{"enabled": true, "granted": true, "config": cfg}
		for k, v := range extra {
			input[k] = v
		}
		check(t, f.request("PUT", "/api/v1/plugins/image-hosting/settings", token, input), status)
	}
	save(nil, 400)
	save(object{"accessKeyId": "TESTACCESS"}, 400)
	save(object{"accessKeyId": "TESTACCESS", "secretAccessKey": "test-private-key-value"}, 200)
	save(nil, 200)
	save(object{"clearSecret": true}, 400)
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "S3 图片", "url": "https://example.com/s3-private"}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	path := "/api/v1/bookmarks/" + bid + "/screenshots"
	shot := data(t, f.request("POST", path, token, object{"image": encoded}), 200)["screenshot"].(map[string]any)
	key := screenshotKey(t, f, str(shot["id"]))
	var address, cipher, storedConfig string
	if err := f.db.QueryRow("SELECT url,ciphertext,config FROM image_host_objects WHERE r2_key=?", key).Scan(&address, &cipher, &storedConfig); err != nil {
		t.Fatal("私有图片上传失败", err)
	}
	if objectExists(f, key) || !strings.HasPrefix(cipher, "v1.") || strings.Contains(cipher, "test-private-key-value") || strings.Contains(storedConfig, "TESTACCESS") {
		t.Fatal("私有图片或凭据未正确持久化")
	}
	link := str(shot["url"])
	got := f.request("GET", link, "", nil)
	if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), content) {
		t.Fatal("私有桶图片读取失败", got.Code)
	}
	details := data(t, f.request("GET", "/api/v1/plugins", token, nil), 200)
	if strings.Contains(mustJSON(details), "test-private-key-value") || strings.Contains(mustJSON(details), "TESTACCESS") {
		t.Fatal("目录泄漏 S3 凭据")
	}
	// 切换后端和清空新上传凭据后仍能读取既有私有图片。
	oldCfg := cfg
	cfg = object{"backend": "http", "endpoint": "https://storage.example.com/upload", "purposes": []string{}}
	save(object{"enabled": false, "clearSecret": true}, 200)
	if got = f.request("GET", link, "", nil); got.Code != 200 {
		t.Fatal("切换配置破坏旧图片")
	}
	var credentialCount int
	_ = f.db.QueryRow("SELECT COUNT(*) FROM plugin_credentials WHERE user_id=? AND plugin_id=?", uid, plugin.ImageHostingID).Scan(&credentialCount)
	if credentialCount != 0 {
		t.Fatal("新上传密钥未清除")
	}
	// 地址异常不能诱导宿主为非授权对象发送凭据。
	before := calls
	_, _ = f.db.Exec("UPDATE image_host_objects SET url=? WHERE r2_key=?", "https://storage.example.com/other-bucket/markvault/00000000000000000000000000000000.png", key)
	check(t, f.request("GET", link, "", nil), 502)
	if calls != before {
		t.Fatal("向非授权对象发送了签名")
	}
	_, _ = f.db.Exec("UPDATE image_host_objects SET url=? WHERE r2_key=?", address, key)
	cfg = oldCfg
	cfg["publicURL"] = "https://cdn.example.com/public"
	save(object{"accessKeyId": "NEWACCESS", "secretAccessKey": "test-updated-key-value"}, 200)
	publicShot := data(t, f.request("POST", path, token, object{"image": encoded}), 200)["screenshot"].(map[string]any)
	publicKey := screenshotKey(t, f, str(publicShot["id"]))
	if err := f.db.QueryRow("SELECT ciphertext FROM image_host_objects WHERE r2_key=?", publicKey).Scan(&cipher); err != nil || cipher != "" {
		t.Fatal("公开图片不应保留私有读取密钥", err)
	}
	if got = f.request("GET", str(publicShot["url"]), "", nil); got.Code != 200 || publicReads < 2 {
		t.Fatal("CDN 读取失败")
	}
	var count int
	_ = f.db.QueryRow("SELECT COUNT(*) FROM image_host_objects WHERE r2_key=?", key).Scan(&count)
	if count != 0 {
		t.Fatal("替换后旧私有读取凭据未清理")
	}
	deny = true
	fallback := data(t, f.request("POST", path, token, object{"image": encoded}), 200)["screenshot"].(map[string]any)
	if !objectExists(f, screenshotKey(t, f, str(fallback["id"]))) {
		t.Fatal("S3 拒绝上传后未保留本地图片")
	}
}
