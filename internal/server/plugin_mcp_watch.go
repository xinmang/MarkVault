package server

import (
	"context"
	"net/http"
	"time"
)

type mcpWatch struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// 每个用户和连接仅有一个订阅；重连不重放工具执行，只重新发现工具。
func (s *Server) watchMCP(r *http.Request, c mcpConnection) {
	key := userID(r) + "/" + c.ID
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.mcpWatches == nil {
		s.mcpWatches = map[string]*mcpWatch{}
	}
	if s.mcpWatches[key] != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
	watch := &mcpWatch{cancel: cancel, done: make(chan struct{})}
	s.mcpWatches[key] = watch
	go func() {
		defer close(watch.done)
		defer func() {
			s.lifecycleMu.Lock()
			if s.mcpWatches[key] == watch {
				delete(s.mcpWatches, key)
			}
			s.lifecycleMu.Unlock()
		}()
		request := r.WithContext(ctx)
		delay := time.Second
		for ctx.Err() == nil {
			if s.requirePlugin(request, "markvault.mcp-client") != nil {
				return
			}
			connections, err := s.mcpConnections(request)
			if err != nil {
				return
			}
			found := false
			for _, item := range connections {
				if item.ID == c.ID {
					c = item
					found = true
					break
				}
			}
			if !found {
				return
			}
			session, err := s.openMCP(request, c)
			if err == nil {
				err = session.Watch()
				if err == nil {
					timer := time.NewTicker(time.Minute)
					running := true
					for running && ctx.Err() == nil {
						tools, e := session.Tools()
						if e != nil || validateMCPTools(tools) != nil {
							break
						}
						// 定义变更撤销免确认批准，确认凭证通过代次与摘要自动失效。
						_, e = s.db.ExecContext(ctx, "UPDATE plugin_mcp_connections SET tools=?,generation=generation+1,auto_approved='[]' WHERE user_id=? AND id=? AND url=? AND transport=? AND tools<>?", mustJSON(tools), userID(r), c.ID, c.URL, c.Transport, mustJSON(tools))
						if e != nil {
							break
						}
						delay = time.Second
						select {
						case <-ctx.Done():
							running = false
						case <-session.Lost():
							running = false
						case <-session.Changes():
						case <-timer.C:
						}
					}
					timer.Stop()
				}
				session.Close()
			}
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			delay = min(delay*2, 30*time.Second)
		}
	}()
}

func (s *Server) stopMCPWatches(user string) {
	s.lifecycleMu.Lock()
	watches := []*mcpWatch{}
	for key, watch := range s.mcpWatches {
		if user == "" || len(key) > len(user) && key[:len(user)+1] == user+"/" {
			watch.cancel()
			delete(s.mcpWatches, key)
			watches = append(watches, watch)
		}
	}
	s.lifecycleMu.Unlock()
	for _, watch := range watches {
		<-watch.done
	}
}
