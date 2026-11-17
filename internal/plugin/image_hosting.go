package plugin

import (
	"context"
	"encoding/json"
	"net/http"
)

const ImageHostingID = "markvault.image-hosting"

// ImageHostingConfig 的用途值与 shared/image-hosting.ts 保持一致。密钥独立加密保存。
type ImageHostingConfig struct {
	Backend    string   `json:"backend"`
	Endpoint   string   `json:"endpoint"`
	Bucket     string   `json:"bucket"`
	Region     string   `json:"region"`
	Prefix     string   `json:"prefix"`
	PathStyle  bool     `json:"pathStyle"`
	PublicURL  string   `json:"publicURL"`
	FileField  string   `json:"fileField"`
	URLPath    string   `json:"urlPath"`
	AuthHeader string   `json:"authHeader"`
	Purposes   []string `json:"purposes"`
}

func DecodeImageHostingConfig(value map[string]any) (ImageHostingConfig, error) {
	// 未标记后端的旧配置仍按 HTTP 解释，避免升级后改变现有上传方式。
	c := ImageHostingConfig{Backend: "http", Region: "auto", PathStyle: true, FileField: "file", URLPath: "data.url", AuthHeader: "Authorization", Purposes: []string{}}
	raw, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(raw, &c)
	}
	return c, err
}

// ImageHosting 由启动入口注入；宿主负责用途、权限、网络策略与持久化。
type ImageHosting interface {
	Validate(ImageHostingConfig) error
	ValidateCredentials(ImageHostingConfig, string) error
	Upload(context.Context, *http.Client, ImageHostingConfig, string, string, []byte) (string, error)
	ReadRequest(context.Context, ImageHostingConfig, string, string) (*http.Request, error)
}

// S3Credentials 的完整值只进入加密凭据列，不出现在插件公开配置中。
type S3Credentials struct {
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}
