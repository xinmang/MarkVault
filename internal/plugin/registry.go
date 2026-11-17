package plugin

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type Phase string

const (
	Installed   Phase = "installed"
	Enabled     Phase = "enabled"
	Waiting     Phase = "waiting"
	Running     Phase = "running"
	Failed      Phase = "failed"
	Disabled    Phase = "disabled"
	Uninstalled Phase = "uninstalled"
)

type Cleanup func(context.Context) error
type Activate func(context.Context) (Cleanup, error)
type Registration struct {
	Manifest Manifest
	Activate Activate
	Phase    Phase
	Reason   string
}

// Registry 管理可信宿主的贡献生命周期；状态按注册表隔离，不在启用时替用户授权依赖。
type Registry struct {
	mu      sync.Mutex
	entries map[string]*Registration
	cleanup map[string]Cleanup
	order   []string
}

func NewRegistry() *Registry {
	return &Registry{entries: map[string]*Registration{}, cleanup: map[string]Cleanup{}}
}
func (r *Registry) Register(m Manifest, start Activate) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entries[m.ID]; exists {
		return errors.New("插件重复注册")
	}
	r.entries[m.ID] = &Registration{Manifest: m, Activate: start, Phase: Installed}
	return nil
}
func (r *Registry) Start(ctx context.Context, enabled map[string]bool) map[string]Phase {
	r.mu.Lock()
	defer r.mu.Unlock()
	// 先撤销失去授权的依赖及其全部使用者，再重新按依赖顺序启动。
	for _, id := range append([]string(nil), r.order...) {
		if !enabled[id] {
			_ = r.stopLocked(ctx, id)
		}
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var start func(string) bool
	start = func(id string) bool {
		entry := r.entries[id]
		if entry == nil {
			return false
		}
		if entry.Phase == Running {
			return true
		}
		if !enabled[id] {
			entry.Phase = Disabled
			return false
		}
		if visited[id] {
			return entry.Phase == Running
		}
		if visiting[id] {
			entry.Phase = Waiting
			entry.Reason = "依赖循环"
			return false
		}
		visiting[id] = true
		defer func() { delete(visiting, id); visited[id] = true }()
		entry.Phase = Enabled
		for dep, version := range entry.Manifest.Dependencies {
			other := r.entries[dep]
			if other == nil || other.Manifest.Version != version || !start(dep) {
				entry.Phase = Waiting
				entry.Reason = "依赖未启用或不可用: " + dep
				return false
			}
		}
		cleanup, err := safeActivate(ctx, entry.Activate)
		if err != nil {
			entry.Phase = Failed
			entry.Reason = "插件启动失败"
			return false
		}
		entry.Phase = Running
		entry.Reason = ""
		r.cleanup[id] = cleanup
		r.order = append(r.order, id)
		return true
	}
	result := map[string]Phase{}
	keys := make([]string, 0, len(r.entries))
	for id := range r.entries {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		start(id)
	}
	for id, entry := range r.entries {
		result[id] = entry.Phase
	}
	return result
}
func safeActivate(ctx context.Context, start Activate) (cleanup Cleanup, err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("插件启动异常")
		}
	}()
	if start == nil {
		return nil, nil
	}
	return start(ctx)
}
func (r *Registry) Stop(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stopLocked(ctx, id)
}
func (r *Registry) stopLocked(ctx context.Context, id string) error {
	affected := map[string]bool{id: true}
	for changed := true; changed; {
		changed = false
		for name, entry := range r.entries {
			if affected[name] {
				continue
			}
			for dep := range entry.Manifest.Dependencies {
				if affected[dep] {
					affected[name] = true
					changed = true
				}
			}
		}
	}
	for name := range affected {
		if entry := r.entries[name]; entry != nil {
			entry.Phase = Disabled
			entry.Reason = ""
		}
	}
	var combined error
	kept := []string{}
	for i := len(r.order) - 1; i >= 0; i-- {
		name := r.order[i]
		if !affected[name] {
			continue
		}
		if clean := r.cleanup[name]; clean != nil {
			if err := safeCleanup(ctx, clean); err != nil {
				combined = errors.Join(combined, fmt.Errorf("%s: 清理失败", name))
			}
		}
		delete(r.cleanup, name)
		r.entries[name].Phase = Disabled
	}
	for _, name := range r.order {
		if !affected[name] {
			kept = append(kept, name)
		}
	}
	r.order = kept
	return combined
}
func safeCleanup(ctx context.Context, cleanup Cleanup) (err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("清理异常")
		}
	}()
	return cleanup(ctx)
}
func (r *Registry) Unregister(ctx context.Context, id string) error {
	if err := r.Stop(ctx, id); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry := r.entries[id]; entry != nil {
		entry.Phase = Uninstalled
	}
	delete(r.entries, id)
	return nil
}

func (r *Registry) Snapshot() map[string]Registration {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := map[string]Registration{}
	for id, entry := range r.entries {
		result[id] = *entry
	}
	return result
}
func (r *Registry) Close(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var err error
	for len(r.order) > 0 {
		err = errors.Join(err, r.stopLocked(ctx, r.order[len(r.order)-1]))
	}
	return err
}
