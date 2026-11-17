package plugin

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
)

const MaxArchive = 16 << 20
const MaxExpanded = 48 << 20

type Package struct {
	Manifest Manifest
	Digest   string
	Files    map[string][]byte
	Archive  []byte
}

// ReadPackage 不解压到磁盘，先检查每个成员和实际解压量，再允许原子安装。
func ReadPackage(raw []byte) (*Package, error) {
	if len(raw) > MaxArchive {
		return nil, errors.New("插件包超过 16 MiB")
	}
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, errors.New("无效 ZIP")
	}
	if len(z.File) > 256 {
		return nil, errors.New("插件文件数超过 256")
	}
	p := &Package{Archive: raw, Digest: fmt.Sprintf("%x", sha256.Sum256(raw)), Files: map[string][]byte{}}
	total := int64(0)
	names := map[string]bool{}
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !SafePath(name) || names[strings.ToLower(name)] || (!f.Mode().IsRegular() && !f.FileInfo().IsDir()) {
			return nil, errors.New("插件包包含不安全路径、重复文件或链接")
		}
		names[strings.ToLower(name)] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > MaxExpanded {
			return nil, errors.New("插件解压大小超限")
		}
		reader, e := f.Open()
		if e != nil {
			return nil, e
		}
		data, e := io.ReadAll(io.LimitReader(reader, MaxExpanded-total+1))
		reader.Close()
		if e != nil {
			return nil, e
		}
		total += int64(len(data))
		if total > MaxExpanded {
			return nil, errors.New("插件解压大小超限")
		}
		p.Files[f.Name] = data
	}
	p.Manifest, err = ParseManifest(p.Files["manifest.json"])
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(p.Manifest.ID, "markvault.") {
		return nil, errors.New("内置插件命名空间不能被安装包覆盖")
	}
	entries := []string{p.Manifest.Server}
	for _, c := range p.Manifest.Contributes {
		entries = append(entries, c.Entry)
	}
	for _, entry := range entries {
		if entry != "" {
			if _, ok := p.Files[entry]; !ok {
				return nil, fmt.Errorf("入口文件不存在: %s", entry)
			}
		}
	}
	return p, nil
}
