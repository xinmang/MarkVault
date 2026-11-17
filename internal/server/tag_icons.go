package server

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
)

const maxTagIconBytes = 64 * 1024

var tagBrandIcons = strings.Fields("github gitlab docker kubernetes python javascript typescript react vuedotjs go rust nodedotjs linux ubuntu debian archlinux nginx redis mysql postgresql sqlite mongodb cloudflare google youtube bilibili telegram discord reddit x notion obsidian figma vercel netlify stackoverflow npm pnpm homeassistant synology nextdotjs svelte zhihu")
var tagGenericIcons = strings.Fields("tag code terminal globe book server database cloud folder star heart music film study tools game idea design shield rss")

func validTagIcon(value any) bool {
	if value == nil {
		return true
	}
	text, ok := value.(string)
	if !ok || text == "" {
		return false
	}
	if text == "none" {
		return true
	}
	if strings.HasPrefix(text, "brand:") {
		return contains(tagBrandIcons, strings.TrimPrefix(text, "brand:"))
	}
	if strings.HasPrefix(text, "icon:") {
		return contains(tagGenericIcons, strings.TrimPrefix(text, "icon:"))
	}
	if strings.HasPrefix(text, "data:") {
		// 仅接收体积受限的位图，上传内容不会作为 HTML 或 SVG 执行。
		if len(text) > 64+((maxTagIconBytes+2)/3)*4 {
			return false
		}
		header, encoded, found := strings.Cut(text, ",")
		if !found || !contains([]string{"data:image/png;base64", "data:image/jpeg;base64", "data:image/gif;base64", "data:image/webp;base64"}, header) {
			return false
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || len(raw) == 0 || len(raw) > maxTagIconBytes {
			return false
		}
		return "data:"+http.DetectContentType(raw)+";base64" == header
	}
	if len(text) > 2048 {
		return false
	}
	parsed, err := url.ParseRequestURI(text)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "" && parsed.User == nil
}
