package plugin

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Session 持有单个用户插件的 Worker；调用串行，空闲期间仍处理受限的宿主请求。
type Session struct {
	ctx        context.Context
	cancel     context.CancelFunc
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	encoder    *json.Encoder
	writeMu    sync.Mutex
	callMu     sync.Mutex
	mu         sync.Mutex
	broker     Broker
	callCtx    context.Context
	scope      int
	background Broker
	result     chan sessionMessage
	done       chan struct{}
	closeOnce  sync.Once
}
type sessionMessage struct {
	Scope  int
	Type   string
	ID     int
	Method string
	Args   map[string]any
	Value  any
}

func (r *Runtime) Open(parent context.Context, user, id, code string, broker Broker) (*Session, error) {
	ctx, cancel := context.WithCancel(parent)
	select {
	case r.slots <- struct{}{}:
	case <-ctx.Done():
		cancel()
		return nil, ctx.Err()
	default:
		cancel()
		return nil, errors.New("插件进程配额已满")
	}
	cache, err := os.MkdirTemp("", "markvault-plugin-")
	if err != nil {
		cancel()
		<-r.slots
		return nil, err
	}
	cmd := exec.CommandContext(ctx, r.Path, "run", "--unstable-worker-options", "--no-prompt", "--no-config", "--no-lock", "--no-remote", "--no-npm", "--deny-net", "--deny-read", "--deny-write", "--deny-env", "--deny-run", "--deny-ffi", "--deny-sys", "--v8-flags=--max-old-space-size=128", "data:text/javascript;base64,"+base64.StdEncoding.EncodeToString([]byte(bootstrap)))
	cmd.Env = []string{"DENO_NO_UPDATE_CHECK=1", "DENO_NO_PROMPT=1", "DENO_DIR=" + cache}
	cmd.Stderr = io.Discard
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		os.RemoveAll(cache)
		<-r.slots
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		stdin.Close()
		os.RemoveAll(cache)
		<-r.slots
		return nil, err
	}
	key := user + "/" + id
	r.mu.Lock()
	if len(r.active[key]) >= 2 {
		r.mu.Unlock()
		cancel()
		stdin.Close()
		stdout.Close()
		os.RemoveAll(cache)
		<-r.slots
		return nil, errors.New("插件并发配额已满")
	}
	if r.active[key] == nil {
		r.active[key] = map[*exec.Cmd]context.CancelFunc{}
	}
	r.active[key][cmd] = cancel
	r.mu.Unlock()
	cleanup := func() {
		cancel()
		stdin.Close()
		os.RemoveAll(cache)
		<-r.slots
		r.mu.Lock()
		delete(r.active[key], cmd)
		if len(r.active[key]) == 0 {
			delete(r.active, key)
		}
		r.mu.Unlock()
	}
	if err = cmd.Start(); err != nil {
		stdout.Close()
		cleanup()
		return nil, errors.New("Deno 运行时不可用")
	}
	s := &Session{ctx: ctx, cancel: cancel, cmd: cmd, stdin: stdin, encoder: json.NewEncoder(stdin), background: broker, result: make(chan sessionMessage, 2), done: make(chan struct{})}
	go func() {
		defer close(s.done)
		defer cleanup()
		defer cmd.Wait()
		defer cmd.Process.Kill()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			var msg sessionMessage
			if json.Unmarshal(scanner.Bytes(), &msg) != nil {
				return
			}
			if msg.Type == "rpc" {
				s.mu.Lock()
				b, parent := s.background, ctx
				if msg.Scope != 0 {
					b = nil
					if msg.Scope == s.scope && s.broker != nil {
						b, parent = s.broker, s.callCtx
					}
				}
				s.mu.Unlock()
				rpcCtx, rpcCancel := context.WithTimeout(parent, 30*time.Second)
				var value any
				e := errors.New("调用上下文已失效")
				if b != nil {
					value, e = b(rpcCtx, msg.Method, msg.Args)
				}
				rpcCancel()
				response := map[string]any{"type": "response", "id": msg.ID, "value": value}
				if e != nil {
					response["error"] = "宿主拒绝调用"
				}
				if s.send(response) != nil {
					return
				}
				continue
			}
			select {
			case s.result <- msg:
			case <-ctx.Done():
				return
			}
			if msg.Type == "error" || msg.Type == "disposed" {
				return
			}
		}
	}()
	if err = s.send(map[string]any{"type": "start", "persistent": true, "code": base64.StdEncoding.EncodeToString([]byte(code))}); err != nil {
		s.Close()
		return nil, err
	}
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case msg := <-s.result:
		if msg.Type == "ready" {
			return s, nil
		}
	case <-s.done:
	case <-timer.C:
	case <-ctx.Done():
	}
	s.Close()
	return nil, errors.New("插件启动失败或超时")
}
func (s *Session) send(v any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.encoder.Encode(v)
}
func (s *Session) Alive() bool {
	select {
	case <-s.done:
		return false
	default:
		return s.ctx.Err() == nil
	}
}
func (s *Session) Call(ctx context.Context, method string, args map[string]any, broker Broker) (any, error) {
	// 排队等待也响应取消，避免已超时的请求继续执行写操作。
	for !s.callMu.TryLock() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.done:
			return nil, errors.New("插件已停止")
		case <-time.After(5 * time.Millisecond):
		}
	}
	defer s.callMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !s.Alive() {
		return nil, errors.New("插件已停止")
	}
	s.mu.Lock()
	s.broker = broker
	s.callCtx = ctx
	s.scope++
	scope := s.scope
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.broker = nil; s.mu.Unlock() }()
	if err := s.send(map[string]any{"type": "invoke", "scope": scope, "method": method, "args": args}); err != nil {
		return nil, err
	}
	select {
	case msg := <-s.result:
		if msg.Type == "result" {
			return msg.Value, nil
		}
		return nil, errors.New("插件执行失败")
	case <-s.done:
		return nil, errors.New("插件进程已退出")
	case <-ctx.Done():
		s.cancel()
		return nil, ctx.Err()
	}
}
func (s *Session) Close() {
	s.closeOnce.Do(func() {
		_ = s.send(map[string]any{"type": "dispose"})
		timer := time.NewTimer(time.Second)
		defer timer.Stop()
		select {
		case <-s.done:
		case <-timer.C:
			s.cancel()
			<-s.done
		}
		s.cancel()
	})
}
