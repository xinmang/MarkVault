package server

import (
	"bytes"
	stdhtml "html"
	"io"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// 同时消费注释和字符串，避免将其中出现的 url(...) 当作独立资源地址。
var snapshotCSSURL = regexp.MustCompile(`(?is)/\*.*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"')]*?)\s*\)`)

// 只改写真实的图片属性及样式资源，绝不向外部地址、链接或正文补入签名。
func (s *Server) rewriteSnapshotHTML(content []byte, images []object, uid, bid, sid, version, expiry string) (string, error) {
	var output strings.Builder
	output.Grow(len(content))
	// 仅为当前快照实际保存的图片签名，并复用结果，避免大量重复引用放大处理开销。
	links := make(map[string]string, len(images))
	replacements := make([]string, 0, len(images)*2)
	for _, image := range images {
		hash := str(image["image_hash"])
		if !imageHashPattern.MatchString(hash) {
			continue
		}
		q := url.Values{"u": {uid}, "b": {bid}, "s": {sid}, "v": {version}, "exp": {expiry}}
		q.Set("sig", s.signature("snapshot-image:"+hash+":"+uid+":"+bid+":"+sid+":"+version+":"+expiry))
		signed := "/api/snapshot-images/" + hash + "?" + q.Encode()
		links[hash] = signed
		replacements = append(replacements, stdhtml.EscapeString(signed), signed)
	}
	queryEncoding := strings.NewReplacer(replacements...)
	sign := func(raw string) string {
		value := strings.TrimSpace(raw)
		if !strings.HasPrefix(value, "/api/snapshot-images/") {
			return raw
		}
		parsed, err := url.Parse(value)
		if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" {
			return raw
		}
		match := snapshotImageURL.FindStringSubmatch(parsed.Path)
		if len(match) < 2 || match[0] != parsed.Path || !imageHashPattern.MatchString(match[1]) {
			return raw
		}
		if signed, ok := links[match[1]]; ok {
			return signed
		}
		return raw
	}
	tokenizer := html.NewTokenizer(bytes.NewReader(content))
	inStyle := false
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			if err := tokenizer.Err(); err != io.EOF {
				return "", err
			}
			return output.String(), nil
		}
		raw := string(tokenizer.Raw())
		switch kind {
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokenizer.Token()
			if token.Data == "style" && kind == html.StartTagToken {
				inStyle = true
			}
			changed := false
			attributes := token.Attr[:0]
			for _, attribute := range token.Attr {
				// SVG 的基地址也不能把本站相对路径重新指向外部站点。
				if attribute.Key == "xml:base" || (attribute.Namespace == "xml" && attribute.Key == "base") {
					changed = true
					continue
				}
				value := attribute.Val
				switch attribute.Key {
				case "src":
					if token.Data == "img" || token.Data == "source" {
						value = sign(value)
					}
				case "srcset":
					if token.Data == "img" || token.Data == "source" {
						value = rewriteSnapshotSrcset(value, sign)
					}
				case "href", "xlink:href":
					if token.Data == "image" {
						value = sign(value)
					}
				case "poster":
					if token.Data == "video" {
						value = sign(value)
					}
				case "style":
					value = rewriteSnapshotCSS(value, sign)
				}
				if value != attribute.Val {
					changed = true
					attribute.Val = value
				}
				attributes = append(attributes, attribute)
			}
			if changed {
				token.Attr = attributes
				raw = token.String()
				// 签名 URL 的路径与参数已严格编码，保留原有查询串形式供兼容客户端读取。
				raw = queryEncoding.Replace(raw)
			}
		case html.EndTagToken:
			if token := tokenizer.Token(); token.Data == "style" {
				inStyle = false
			}
		case html.TextToken:
			if inStyle {
				raw = rewriteSnapshotCSS(raw, sign)
			}
		}
		output.WriteString(raw)
	}
}

func rewriteSnapshotCSS(value string, sign func(string) string) string {
	return snapshotCSSURL.ReplaceAllStringFunc(value, func(match string) string {
		if !strings.HasPrefix(strings.ToLower(match), "url(") {
			return match
		}
		address := strings.TrimSpace(match[4 : len(match)-1])
		if len(address) >= 2 && (address[0] == '\'' || address[0] == '"') && address[len(address)-1] == address[0] {
			address = address[1 : len(address)-1]
		}
		if signed := sign(address); signed != address {
			return `url("` + signed + `")`
		}
		return match
	})
}

func htmlSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r' || b == '\n' || b == '\f'
}

func rewriteSnapshotSrcset(value string, sign func(string) string) string {
	var output strings.Builder
	for index := 0; index < len(value); {
		start := index
		for index < len(value) && (htmlSpace(value[index]) || value[index] == ',') {
			index++
		}
		output.WriteString(value[start:index])
		start = index
		// URL 内部的逗号属于地址本身，不能按逗号直接拆分外部 URL 或 data URL。
		for index < len(value) && !htmlSpace(value[index]) {
			index++
		}
		end := index
		for end > start && value[end-1] == ',' {
			end--
		}
		output.WriteString(sign(value[start:end]))
		output.WriteString(value[end:index])
		if end < index {
			continue
		}
		start = index
		depth := 0
		for index < len(value) {
			c := value[index]
			index++
			if c == '(' {
				depth++
			} else if c == ')' && depth > 0 {
				depth--
			} else if c == ',' && depth == 0 {
				break
			}
		}
		output.WriteString(value[start:index])
	}
	return output.String()
}
