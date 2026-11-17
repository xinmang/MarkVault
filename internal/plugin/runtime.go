package plugin

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

//go:embed bootstrap.js
var bootstrap string

const DenoVersion = "2.9.8"

type Broker func(context.Context, string, map[string]any) (any, error)
type Runtime struct {
	Path     string
	slots    chan struct{}
	mu       sync.Mutex
	active   map[string]map[*exec.Cmd]context.CancelFunc
	requests map[string]map[uint64]context.CancelFunc
	sequence uint64
}

func NewRuntime(path string) *Runtime {
	r := &Runtime{Path: path, slots: make(chan struct{}, 8), active: map[string]map[*exec.Cmd]context.CancelFunc{}, requests: map[string]map[uint64]context.CancelFunc{}}
	if path == "" {
		r.Path = "deno"
	}
	return r
}
func (r *Runtime) Available() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.Path, "--version")
	raw, err := cmd.Output()
	return err == nil && strings.HasPrefix(string(raw), "deno "+DenoVersion+" ")
}
func (r *Runtime) Stop(user, id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, requests := range r.requests {
		if (id == "" && user == "") || key == user+"/"+id || (user == "" && strings.HasSuffix(key, "/"+id)) {
			for _, cancel := range requests {
				cancel()
			}
		}
	}
	for key, commands := range r.active {
		if (id == "" && user == "") || key == user+"/"+id || (user == "" && strings.HasSuffix(key, "/"+id)) {
			for _, cancel := range commands {
				cancel()
			}
		}
	}
}

// Track 将外部连接纳入同一停用和撤权取消机制。
func (r *Runtime) Track(parent context.Context, user, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	key := user + "/" + id
	r.mu.Lock()
	r.sequence++
	seq := r.sequence
	if r.requests[key] == nil {
		r.requests[key] = map[uint64]context.CancelFunc{}
	}
	r.requests[key][seq] = cancel
	r.mu.Unlock()
	return ctx, func() {
		cancel()
		r.mu.Lock()
		delete(r.requests[key], seq)
		if len(r.requests[key]) == 0 {
			delete(r.requests, key)
		}
		r.mu.Unlock()
	}
}

// Call 每次调用独立进程，结束时释放全部 Worker 和监听器，不保留跨用户状态。
func (r *Runtime) Call(parent context.Context, user, id, code, method string, args map[string]any, broker Broker) (any, error) {
	return r.CallWithTimeout(parent, user, id, code, method, args, broker, 30*time.Second)
}

func (r *Runtime) CallWithTimeout(parent context.Context, user, id, code, method string, args map[string]any, broker Broker, timeout time.Duration) (any, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	cmd := exec.CommandContext(ctx, r.Path, "run", "--unstable-worker-options", "--no-prompt", "--no-config", "--no-lock", "--no-remote", "--no-npm", "--deny-net", "--deny-read", "--deny-write", "--deny-env", "--deny-run", "--deny-ffi", "--deny-sys", "--v8-flags=--max-old-space-size=128", "data:text/javascript;base64,"+base64.StdEncoding.EncodeToString([]byte(bootstrap)))
	cache, err := os.MkdirTemp("", "markvault-plugin-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(cache)
	cmd.Env = []string{"DENO_NO_UPDATE_CHECK=1", "DENO_NO_PROMPT=1", "DENO_DIR=" + cache}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	r.mu.Lock()
	key := user + "/" + id
	if len(r.active[key]) >= 2 {
		r.mu.Unlock()
		return nil, errors.New("插件并发配额已满")
	}
	if r.active[key] == nil {
		r.active[key] = map[*exec.Cmd]context.CancelFunc{}
	}
	r.active[key][cmd] = cancel
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.active[key], cmd)
		if len(r.active[key]) == 0 {
			delete(r.active, key)
		}
		r.mu.Unlock()
	}()
	if err = cmd.Start(); err != nil {
		return nil, errors.New("Deno 运行时不可用")
	}
	defer func() { stdin.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	encoder := json.NewEncoder(stdin)
	if err = encoder.Encode(map[string]any{"type": "start", "code": base64.StdEncoding.EncodeToString([]byte(code)), "method": method, "args": args}); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	calls := 0
	for scanner.Scan() {
		var msg struct {
			Type   string         `json:"type"`
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Args   map[string]any `json:"args"`
			Value  any            `json:"value"`
		}
		if json.Unmarshal(scanner.Bytes(), &msg) != nil {
			return nil, errors.New("插件协议无效")
		}
		switch msg.Type {
		case "result":
			return msg.Value, nil
		case "error":
			return nil, errors.New("插件执行失败")
		case "rpc":
			calls++
			if calls > 100 {
				return nil, errors.New("插件调用配额超限")
			}
			value, e := broker(ctx, msg.Method, msg.Args)
			response := map[string]any{"type": "response", "id": msg.ID, "value": value}
			if e != nil {
				response["error"] = "宿主拒绝调用"
			}
			if encoder.Encode(response) != nil {
				return nil, errors.New("插件通信失败")
			}
		default:
			return nil, errors.New("插件消息无效")
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nil, errors.New("插件崩溃或输出超限")
}
