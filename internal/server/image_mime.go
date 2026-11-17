package server

import (
	"bytes"
	"encoding/xml"
	"io"
	"mime"
	"net/http"
	"strings"
)

func snapshotImageMIME(content []byte, declared string) (string, bool) {
	detected := http.DetectContentType(content)
	if strings.HasPrefix(detected, "image/") {
		return detected, true
	}
	mediaType, _, err := mime.ParseMediaType(declared)
	if err != nil || mediaType != "image/svg+xml" {
		return "", false
	}
	decoder := xml.NewDecoder(bytes.NewReader(content))
	depth, roots := 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return "image/svg+xml", roots == 1 && depth == 0
		}
		if err != nil {
			return "", false
		}
		switch token := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || token.Name.Local != "svg" || token.Name.Space != "http://www.w3.org/2000/svg" {
					return "", false
				}
			}
			depth++
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(token)) != "" {
				return "", false
			}
		case xml.Directive:
			// 不接受 DTD 和实体声明，图片响应另受 sandbox CSP 约束。
			return "", false
		case xml.ProcInst:
			if token.Target != "xml" || roots != 0 {
				return "", false
			}
		}
	}
}
