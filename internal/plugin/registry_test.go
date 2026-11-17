package plugin

import (
	"context"
	"testing"
)

func TestRegistryLifecycleAndFailureIsolation(t *testing.T) {
	r := NewRegistry()
	a, b, bad := sampleManifest(), sampleManifest(), sampleManifest()
	b.ID = "example.child"
	b.Dependencies = map[string]string{a.ID: a.Version}
	bad.ID = "example.broken"
	events := []string{}
	register := func(m Manifest) {
		if err := r.Register(m, func(context.Context) (Cleanup, error) {
			events = append(events, "start:"+m.ID)
			return func(context.Context) error { events = append(events, "stop:"+m.ID); return nil }, nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	register(a)
	register(b)
	if r.Register(a, nil) == nil {
		t.Fatal("重复注册未拒绝")
	}
	_ = r.Register(bad, func(context.Context) (Cleanup, error) { panic("fault") })
	states := r.Start(context.Background(), map[string]bool{a.ID: true, b.ID: true, bad.ID: true})
	if states[a.ID] != Running || states[b.ID] != Running || states[bad.ID] != Failed {
		t.Fatal(states)
	}
	if err := r.Stop(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || events[2] != "stop:"+b.ID || events[3] != "stop:"+a.ID {
		t.Fatal("未逆序清理", events)
	}
	states = r.Start(context.Background(), map[string]bool{b.ID: true})
	if states[b.ID] != Waiting {
		t.Fatal("自动启用了未授权依赖")
	}
}
