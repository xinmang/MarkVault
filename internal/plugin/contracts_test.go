package plugin

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSharedContracts(t *testing.T) {
	raw, err := os.ReadFile("../../shared/plugin-contract-fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string          `json:"name"`
		Valid    bool            `json:"valid"`
		Manifest json.RawMessage `json:"manifest"`
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			_, err := ParseManifest(f.Manifest)
			if (err == nil) != f.Valid {
				t.Fatalf("契约结果不符: %v", err)
			}
		})
	}
}
