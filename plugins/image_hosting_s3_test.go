package plugins

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"markvault/internal/plugin"
)

type hostingTransport func(*http.Request) (*http.Response, error)

func (f hostingTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestS3SigningReference(t *testing.T) {
	req, _ := http.NewRequest("PUT", "https://examplebucket.s3.amazonaws.com/photos/%E4%B8%AD%E6%96%87%20%2B.png", strings.NewReader("image-bytes"))
	stamp, _ := time.Parse(time.RFC3339, "2026-11-05T02:00:00Z")
	credentials := plugin.S3Credentials{AccessKeyID: "AKIDEXAMPLE", SecretAccessKey: "reference-secret-for-tests"}
	signS3(req, credentials, "us-east-1", []byte("image-bytes"), stamp)
	// 固定向量由独立 Python hashlib/hmac 实现生成，覆盖日期、路径编码和载荷摘要。
	const expected = "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261105/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=3327a545c8408de3a2fcaccd348cb9c8f8ff3ac39a75552439a14c935cc70665"
	if got := req.Header.Get("Authorization"); got != expected {
		t.Fatalf("签名不符合固定向量：%s", got)
	}
	if req.Header.Get("X-Amz-Date") != "20261105T020000Z" {
		t.Fatal("签名时间错误")
	}
}

func TestS3AddressingAndPrivateReads(t *testing.T) {
	credentials, _ := json.Marshal(plugin.S3Credentials{AccessKeyID: "TESTACCESS", SecretAccessKey: "test-secret-value"})
	adapter := HTTPImageHosting{}
	for _, tc := range []struct {
		name, endpoint, region string
		pathStyle              bool
	}{
		{"aws", "https://s3.eu-west-1.amazonaws.com", "eu-west-1", false},
		{"r2", "https://account.r2.cloudflarestorage.com", "auto", true},
		{"minio", "https://storage.example.com:9000", "us-east-1", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := plugin.ImageHostingConfig{Backend: "s3", Endpoint: tc.endpoint, Region: tc.region, Bucket: "image-bucket", Prefix: "markvault/images", PathStyle: tc.pathStyle}
			var uploadedURL string
			client := &http.Client{Transport: hostingTransport(func(r *http.Request) (*http.Response, error) {
				uploadedURL = r.URL.String()
				if r.Method != "PUT" || r.Header.Get("Content-Type") != "image/png" || !strings.Contains(r.Header.Get("Authorization"), "/"+tc.region+"/s3/aws4_request") {
					t.Fatal("S3 PUT 请求不符合协议")
				}
				if r.Header.Get("X-Amz-Acl") != "" {
					t.Fatal("上传自动开放了桶对象")
				}
				payload, _ := io.ReadAll(r.Body)
				if string(payload) != "content" {
					t.Fatal("上传载荷改变")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
			})}
			address, err := adapter.Upload(context.Background(), client, c, string(credentials), "image/png", []byte("content"))
			if err != nil {
				t.Fatal(err)
			}
			if address != uploadedURL || strings.Contains(address, "?") {
				t.Fatal("持久化了临时签名 URL")
			}
			expectedHost := strings.TrimPrefix(tc.endpoint, "https://")
			pathPrefix := "/markvault/images/"
			if tc.pathStyle {
				pathPrefix = "/image-bucket" + pathPrefix
			} else {
				expectedHost = "image-bucket." + expectedHost
			}
			if !strings.HasPrefix(address, "https://"+expectedHost+pathPrefix) {
				t.Fatal("桶寻址错误", address)
			}
			request, err := adapter.ReadRequest(context.Background(), c, string(credentials), address)
			if err != nil || request.Method != "GET" || !strings.Contains(request.Header.Get("Authorization"), "Credential=TESTACCESS/") {
				t.Fatal("私有读取未签名", err)
			}
			for _, bad := range []string{strings.Replace(address, expectedHost, "evil.example", 1), strings.Replace(address, "/markvault/images/", "/other/", 1), address + "?redirect=1"} {
				if _, err = adapter.ReadRequest(context.Background(), c, string(credentials), bad); err == nil {
					t.Fatal("给非授权对象签名", bad)
				}
			}
			c.PublicURL = "https://cdn.example.com/base"
			public, err := adapter.Upload(context.Background(), client, c, string(credentials), "image/png", []byte("content"))
			if err != nil || !strings.HasPrefix(public, "https://cdn.example.com/base/markvault/images/") {
				t.Fatal("公开地址错误", public, err)
			}
			request, err = adapter.ReadRequest(context.Background(), c, string(credentials), public)
			if err != nil || request.Header.Get("Authorization") != "" {
				t.Fatal("CDN 请求携带了 S3 密钥", err)
			}
		})
	}
}

func TestS3ConfigurationBoundaries(t *testing.T) {
	valid := plugin.ImageHostingConfig{Backend: "s3", Endpoint: "https://s3.example.com", Bucket: "image-bucket", Region: "auto", PathStyle: true}
	adapter := HTTPImageHosting{}
	for _, change := range []func(*plugin.ImageHostingConfig){
		func(c *plugin.ImageHostingConfig) { c.Bucket = "../other" },
		func(c *plugin.ImageHostingConfig) { c.Bucket = "127.0.0.1" },
		func(c *plugin.ImageHostingConfig) { c.Prefix = "a/../other" },
		func(c *plugin.ImageHostingConfig) { c.Region = "auto/evil" },
		func(c *plugin.ImageHostingConfig) { c.Endpoint += "/bucket" },
		func(c *plugin.ImageHostingConfig) { c.PublicURL = "https://user:pass@cdn.example.com" },
		func(c *plugin.ImageHostingConfig) { c.Purposes = []string{"unknown"} },
	} {
		c := valid
		change(&c)
		if adapter.Validate(c) == nil {
			t.Fatal("无效配置通过验证", c)
		}
	}
}
