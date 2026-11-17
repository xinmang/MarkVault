package server

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"markvault/internal/plugin"
)

// userPlugins 按账号保留依赖注册表；进程按需启动，空闲五分钟后逆序回收。
type userPlugins struct {
	mu       sync.Mutex
	registry *plugin.Registry
	states   map[string]plugin.State
	sessions map[string]*plugin.Session
	wanted   map[string]bool
	idle     *time.Timer
}

func (s *Server) pluginSession(r *http.Request, state plugin.State) (*plugin.Session, error) {
	user := userID(r)
	s.lifecycleMu.Lock()
	if s.pluginUsers == nil {
		s.pluginUsers = map[string]*userPlugins{}
	}
	u := s.pluginUsers[user]
	if u == nil {
		u = &userPlugins{}
		s.pluginUsers[user] = u
	}
	s.lifecycleMu.Unlock()
	u.mu.Lock()
	defer u.mu.Unlock()
	list, err := s.plugins.List(r.Context(), user)
	if err != nil {
		return nil, err
	}
	states := map[string]plugin.State{}
	changed := len(list) != len(u.states)
	for _, st := range list {
		states[st.Manifest.ID] = st
		old := u.states[st.Manifest.ID]
		if old.Revision != st.Revision || old.Status != st.Status {
			changed = true
		}
	}
	for _, session := range u.sessions {
		if !session.Alive() {
			changed = true
		}
	}
	if u.registry == nil || changed {
		if u.registry != nil {
			_ = u.registry.Close(context.Background())
		}
		u.registry, u.states, u.sessions, u.wanted = plugin.NewRegistry(), states, map[string]*plugin.Session{}, map[string]bool{}
		for _, st := range list {
			err = u.registry.Register(st.Manifest, func(ctx context.Context) (plugin.Cleanup, error) {
				if st.Manifest.Server == "" {
					return nil, nil
				}
				archive, e := s.plugins.Archive(ctx, st.Manifest.ID, st.Manifest.Version)
				if e != nil {
					return nil, e
				}
				// 后台任务不继承某次请求的确认或 API Key 权限。
				background := s.pluginBroker(r, st, false)
				session, e := s.pluginRuntime.Open(context.Background(), user, st.Manifest.ID, string(archive.Files[st.Manifest.Server]), func(ctx context.Context, method string, args map[string]any) (any, error) {
					if method != "config" && method != "storage.get" && method != "storage.set" {
						return nil, errors.New("后台任务仅可访问插件配置和存储")
					}
					return background(ctx, method, args)
				})
				if e != nil {
					return nil, e
				}
				u.sessions[st.Manifest.ID] = session
				return func(context.Context) error { session.Close(); delete(u.sessions, st.Manifest.ID); return nil }, nil
			})
			if err != nil {
				return nil, err
			}
		}
	}
	current, ok := states[state.Manifest.ID]
	if !ok || current.Status != "running" || current.Revision != state.Revision {
		return nil, problem(409, "插件授权已变化")
	}
	var want func(string)
	want = func(id string) {
		if u.wanted[id] || states[id].Status != "running" {
			return
		}
		u.wanted[id] = true
		for dependency := range states[id].Manifest.Dependencies {
			want(dependency)
		}
	}
	want(state.Manifest.ID)
	phases := u.registry.Start(r.Context(), u.wanted)
	if phases[state.Manifest.ID] != plugin.Running {
		return nil, problem(502, "插件或依赖启动失败")
	}
	if u.idle != nil {
		u.idle.Stop()
	}
	u.idle = time.AfterFunc(5*time.Minute, func() {
		u.mu.Lock()
		defer u.mu.Unlock()
		if u.registry != nil {
			_ = u.registry.Close(context.Background())
			u.registry = nil
		}
	})
	return u.sessions[state.Manifest.ID], nil
}

func (s *Server) callPlugin(r *http.Request, st plugin.State, method string, args object, broker plugin.Broker, timeout time.Duration) (any, error) {
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	session, err := s.pluginSession(r.WithContext(ctx), st)
	if err != nil {
		return nil, err
	}
	return session.Call(ctx, method, args, broker)
}

// 配置、授权、安装变化关闭用户依赖图，下一次调用按新快照启动。
func (s *Server) stopPlugins(user, id string) {
	s.stopMCPWatches(user)
	s.lifecycleMu.Lock()
	users := []*userPlugins{}
	for uid, u := range s.pluginUsers {
		if user == "" || uid == user {
			users = append(users, u)
		}
	}
	s.lifecycleMu.Unlock()
	for _, u := range users {
		u.mu.Lock()
		if u.idle != nil {
			u.idle.Stop()
		}
		if u.registry != nil {
			_ = u.registry.Close(context.Background())
			u.registry = nil
		}
		u.mu.Unlock()
	}
	s.pluginRuntime.Stop(user, id)
}

func (s *Server) Close() error                                     { s.stopPlugins("", ""); return nil }
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }
