package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sampleManifest() Manifest {
	return Manifest{ID: "example.test", Version: "1.0.0", API: "^1.0.0", Name: "测试插件", Author: "测试", Permissions: []string{}, Contributes: []Contribution{{ID: "theme", Kind: "theme", Title: "测试主题", Tokens: map[string]string{"--primary": "#abcdef"}}}}
}
func packageBytes(t *testing.T, m Manifest, extra map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	raw, _ := json.Marshal(m)
	w, _ := z.Create("manifest.json")
	_, _ = w.Write(raw)
	for name, content := range extra {
		w, _ = z.Create(name)
		_, _ = w.Write([]byte(content))
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func TestPackageBoundaries(t *testing.T) {
	m := sampleManifest()
	if _, err := ReadPackage(packageBytes(t, m, nil)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../escape.js", "/absolute.js", "C:/file.js", "a\\b.js", "a/../file.js", "CON", "aux.txt", "foo. ", "manifest.JSON"} {
		t.Run(name, func(t *testing.T) {
			if _, err := ReadPackage(packageBytes(t, m, map[string]string{name: "bad"})); err == nil {
				t.Fatal("不安全路径未拒绝")
			}
		})
	}
	m.ID = "markvault.test"
	if _, err := ReadPackage(packageBytes(t, m, nil)); err == nil {
		t.Fatal("覆盖内置命名空间")
	}
	m = sampleManifest()
	m.Contributes[0].Tokens["--primary"] = "url(https://example.com)"
	if m.Validate() == nil {
		t.Fatal("允许远端样式")
	}
}
func TestDependencies(t *testing.T) {
	a, b := sampleManifest(), sampleManifest()
	b.ID = "example.other"
	a.Dependencies = map[string]string{b.ID: b.Version}
	order, err := Order(map[string]Manifest{a.ID: a, b.ID: b})
	if err != nil || len(order) != 2 || order[0] != b.ID {
		t.Fatalf("依赖顺序错误: %v %v", order, err)
	}
	b.Dependencies = map[string]string{a.ID: a.Version}
	if _, err = Order(map[string]Manifest{a.ID: a, b.ID: b}); err == nil {
		t.Fatal("未检测依赖环")
	}
	if _, err = Order(map[string]Manifest{a.ID: a}); err == nil {
		t.Fatal("未检测缺失依赖")
	}
}
func runtimeForTest(t *testing.T) *Runtime {
	t.Helper()
	path := os.Getenv("MARKVAULT_DENO_PATH")
	if path == "" {
		path = filepath.Join("..", "..", ".data", "tools", "deno", "deno.exe")
	}
	path, _ = filepath.Abs(path)
	r := NewRuntime(path)
	if !r.Available() {
		t.Skip("设置 MARKVAULT_DENO_PATH 运行隔离测试")
	}
	return r
}
func TestRuntimeIsolation(t *testing.T) {
	r := runtimeForTest(t)
	broker := func(_ context.Context, method string, args map[string]any) (any, error) {
		return map[string]any{"method": method, "user": "alice"}, nil
	}
	code := `export async function activate(sdk){return {async invoke(){return await sdk.config()},dispose(){}}}`
	result, err := r.Call(context.Background(), "alice", "example.test", code, "test", nil, broker)
	if err != nil {
		t.Fatal(err)
	}
	if result.(map[string]any)["user"] != "alice" {
		t.Fatal("RPC 身份错误")
	}
	for _, expression := range []string{`Deno.readTextFile('C:/Windows/win.ini')`, `Deno.env.get('PATH')`, `fetch('https://example.com')`, `new Deno.Command('cmd',{args:['/c','echo','bad']}).output()`, `import('file:///C:/Windows/win.ini')`, `import('https://example.com/test.js')`} {
		code = `export function activate(){return {async invoke(){try{await (` + expression + `);return 'escaped'}catch{return 'denied'}}}}`
		result, err = r.Call(context.Background(), "alice", "example.test", code, "test", nil, broker)
		if err != nil {
			t.Fatal(err)
		}
		if result != "denied" {
			t.Fatalf("沙盒越权: %s", expression)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	_, err = r.Call(ctx, "alice", "example.test", `export function activate(){return {invoke(){while(true){}}}}`, "test", nil, broker)
	if err == nil {
		t.Fatal("超时未取消")
	}
}
