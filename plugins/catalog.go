package plugins

import (
	"embed"
	"markvault/internal/plugin"
)

//go:embed packages/*.zip
var packages embed.FS

func Samples() map[string]*plugin.Package {
	result := map[string]*plugin.Package{}
	entries, _ := packages.ReadDir("packages")
	for _, entry := range entries {
		raw, err := packages.ReadFile("packages/" + entry.Name())
		if err != nil {
			continue
		}
		p, err := plugin.ReadPackage(raw)
		if err == nil {
			result[p.Manifest.ID] = p
		}
	}
	return result
}
