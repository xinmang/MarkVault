package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"markvault/internal/plugin"
)

type catalogEntry struct {
	Manifest plugin.Manifest `json:"manifest"`
	URL      string          `json:"url,omitempty"`
	Digest   string          `json:"sha256"`
	Origin   string          `json:"origin"`
}

func (s *Server) pluginCatalog(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	entries := []catalogEntry{}
	for _, p := range s.bundle.Samples {
		entries = append(entries, catalogEntry{Manifest: p.Manifest, Digest: p.Digest, Origin: "official"})
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT entries FROM plugin_catalogs ORDER BY source")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			return err
		}
		var extra []catalogEntry
		if json.Unmarshal([]byte(raw), &extra) == nil {
			entries = append(entries, extra...)
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return success(w, object{"entries": entries})
}
func (s *Server) pluginCatalogRefresh(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requireSiteAdmin(r); err != nil {
		return err
	}
	var input struct {
		URL string `json:"url"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	u, err := url.Parse(input.URL)
	if err != nil || pluginTarget(u) != nil {
		return problem(400, "目录地址必须为 HTTPS")
	}
	client := pluginHTTPClient()
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(r.Context(), "GET", input.URL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return problem(502, "目录刷新失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return problem(502, "目录刷新失败")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		return problem(400, "目录过大")
	}
	var entries []catalogEntry
	if json.Unmarshal(raw, &entries) != nil || len(entries) > 100 {
		return problem(400, "目录格式无效")
	}
	for i := range entries {
		entry := &entries[i]
		if err = entry.Manifest.Validate(); err != nil {
			return problem(400, "目录清单无效")
		}
		target, e := url.Parse(entry.URL)
		if e != nil || pluginTarget(target) != nil || target.Host != "github.com" || !regexp.MustCompile(`^/[^/]+/[^/]+/releases/download/[^/]+/[^/]+\.zip$`).MatchString(target.Path) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(entry.Digest) {
			return problem(400, "目录必须固定到带摘要的 Release ZIP 资产")
		}
		entry.Origin = "community"
	}
	normalized, _ := json.Marshal(entries)
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO plugin_catalogs(source,entries,updated_at) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET entries=excluded.entries,updated_at=excluded.updated_at`, input.URL, string(normalized), time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return err
	}
	return success(w, object{"count": len(entries)})
}
func (s *Server) pluginCatalogInstall(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requireSiteAdmin(r); err != nil {
		return err
	}
	var input struct {
		ID      string `json:"id"`
		Version string `json:"version"`
		Digest  string `json:"sha256"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	install := func(p *plugin.Package, source string) error {
		if p.Manifest.ID != input.ID || p.Manifest.Version != input.Version || p.Digest != input.Digest {
			return problem(400, "目录身份或摘要不匹配")
		}
		if err := s.plugins.Install(r.Context(), userID(r), p, source, func(v, schema map[string]any) error { return validateSchema(v, schema, "config") }); err != nil {
			return problem(400, err.Error())
		}
		s.stopPlugins("", p.Manifest.ID)
		return success(w, object{"id": p.Manifest.ID})
	}
	if p := s.bundle.Samples[input.ID]; p != nil && p.Manifest.Version == input.Version && p.Digest == input.Digest {
		return install(p, "bundled-catalog")
	}
	rows, err := all(r, s.db, "SELECT entries FROM plugin_catalogs")
	if err != nil {
		return err
	}
	for _, row := range rows {
		var entries []catalogEntry
		_ = json.Unmarshal([]byte(str(row["entries"])), &entries)
		for _, entry := range entries {
			if entry.Manifest.ID != input.ID || entry.Manifest.Version != input.Version || entry.Digest != input.Digest {
				continue
			}
			raw, e := s.pluginDownload(r.Context(), entry.URL)
			if e != nil {
				return problem(502, "目录插件下载失败")
			}
			p, e := plugin.ReadPackage(raw)
			if e != nil {
				return problem(400, "目录插件包无效")
			}
			return install(p, entry.URL)
		}
	}
	return problem(404, "目录中没有该版本")
}
