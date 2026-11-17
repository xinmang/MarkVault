package plugin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

type State struct {
	LastError       string         `json:"lastError,omitempty"`
	Manifest        Manifest       `json:"manifest"`
	Origin          string         `json:"origin"`
	Enabled         bool           `json:"enabled"`
	Disabled        bool           `json:"disabled"`
	Status          string         `json:"status"`
	Reason          string         `json:"reason,omitempty"`
	Config          map[string]any `json:"config"`
	Grants          []string       `json:"grants"`
	Revision        string         `json:"revision"`
	Digest          string         `json:"digest,omitempty"`
	Previous        string         `json:"previousVersion,omitempty"`
	PreferenceBound bool           `json:"preferenceBound,omitempty"`
}
type Store struct {
	DB               *sql.DB
	Builtins         map[string]Manifest
	RuntimeAvailable bool
	OfficialDigests  map[string]bool
	Policy           Policy
}

// Policy 由装配方（plugins 包）提供，宿主不内置任何具体插件的名单。
type Policy struct {
	// Preferences 把插件启停绑定到 user_preferences 的布尔列，保持旧设置入口的语义。
	Preferences map[string]string
	// Exclusive 记录插件所属的互斥组；启用一个成员会停用同组的其他成员。
	Exclusive map[string]string
	// Fallback 是互斥组里的兜底成员：启用其他成员时保持原状。
	Fallback map[string]bool
	// DefaultDisabled 的插件由用户按需启用，升级时不自动打开。
	DefaultDisabled map[string]bool
}

// ExclusivePreferences 返回与 column 同属一个互斥组的其他偏好列。
func (p Policy) ExclusivePreferences(column string) []string {
	group := ""
	for id, bound := range p.Preferences {
		if bound == column {
			group = p.Exclusive[id]
		}
	}
	if group == "" {
		return nil
	}
	others := []string{}
	for id, bound := range p.Preferences {
		if bound != column && p.Exclusive[id] == group {
			others = append(others, bound)
		}
	}
	sort.Strings(others)
	return others
}

func (s *Store) List(ctx context.Context, user string) ([]State, error) {
	states := map[string]*State{}
	for id, m := range s.Builtins {
		states[id] = &State{Manifest: m, Origin: "builtin", Enabled: !s.Policy.DefaultDisabled[id], Status: "running", Config: map[string]any{}, Grants: []string{}, Revision: m.Version + ":1:1"}
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT i.plugin_id,i.version,COALESCE(i.previous_version,''),i.disabled,i.generation,v.manifest,v.digest FROM plugin_installations i LEFT JOIN plugin_versions v ON v.plugin_id=i.plugin_id AND v.version=i.version`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, ver, previous string
		var disabled bool
		var gen int
		var raw, digest sql.NullString
		if err = rows.Scan(&id, &ver, &previous, &disabled, &gen, &raw, &digest); err != nil {
			rows.Close()
			return nil, err
		}
		st := states[id]
		if st == nil {
			m, e := ParseManifest([]byte(raw.String))
			if e != nil {
				continue
			}
			st = &State{Manifest: m, Origin: "community", Config: map[string]any{}, Grants: []string{}}
			states[id] = st
		}
		st.Disabled = disabled
		st.Previous = previous
		st.Digest = digest.String
		if st.Origin != "builtin" && s.OfficialDigests[st.Digest] {
			st.Origin = "official"
		}
		st.Revision = fmt.Sprintf("%s:%d:1", ver, gen)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = s.DB.QueryContext(ctx, "SELECT plugin_id,enabled,config,grants,generation,last_error FROM plugin_users WHERE user_id=?", user)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, config, grants, lastError string
		var enabled bool
		var generation int
		if err = rows.Scan(&id, &enabled, &config, &grants, &generation, &lastError); err != nil {
			rows.Close()
			return nil, err
		}
		if st := states[id]; st != nil {
			st.Enabled = enabled
			st.LastError = lastError
			if json.Unmarshal([]byte(config), &st.Config) != nil || st.Config == nil {
				st.Config = map[string]any{}
				st.Enabled = false
			}
			if json.Unmarshal([]byte(grants), &st.Grants) != nil {
				st.Grants = []string{}
				st.Enabled = false
			}
			st.Revision = strings.TrimSuffix(st.Revision, ":1") + fmt.Sprintf(":%d", generation)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var resolve func(string, map[string]bool) bool
	for id, column := range s.Policy.Preferences {
		var enabled bool
		if e := s.DB.QueryRowContext(ctx, "SELECT "+column+" FROM user_preferences WHERE user_id=?", user).Scan(&enabled); e != nil {
			return nil, e
		}
		if st := states[id]; st != nil {
			st.Enabled = enabled
			st.PreferenceBound = true
		}
	}
	resolve = func(id string, visiting map[string]bool) bool {
		st := states[id]
		if st == nil {
			return false
		}
		st.Status = "disabled"
		st.Reason = ""
		if st.Disabled || !st.Enabled {
			return false
		}
		for _, p := range st.Manifest.Permissions {
			if st.Origin != "builtin" && !Has(st.Grants, p) {
				st.Status = "pending-authorization"
				st.Reason = "需要重新授权"
				return false
			}
		}
		if visiting[id] {
			st.Status = "waiting"
			st.Reason = "依赖循环"
			return false
		}
		visiting[id] = true
		defer delete(visiting, id)
		for dep, version := range st.Manifest.Dependencies {
			d := states[dep]
			if d == nil || d.Manifest.Version != version || !resolve(dep, visiting) {
				st.Status = "waiting"
				st.Reason = "依赖不可用: " + dep
				return false
			}
		}
		if st.Manifest.Server != "" && !s.RuntimeAvailable {
			st.Status = "unavailable"
			st.Reason = "Deno 2.9.8 运行时不可用"
			return false
		}
		st.Status = "running"
		return true
	}
	result := []State{}
	keys := []string{}
	for id := range states {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		resolve(id, map[string]bool{})
		result = append(result, *states[id])
	}
	return result, nil
}
func (s *Store) Get(ctx context.Context, user, id string) (State, error) {
	list, err := s.List(ctx, user)
	if err != nil {
		return State{}, err
	}
	for _, v := range list {
		if v.Manifest.ID == id {
			return v, nil
		}
	}
	return State{}, sql.ErrNoRows
}
func (s *Store) Save(ctx context.Context, user, id string, enabled bool, config map[string]any, grants []string) error {
	st, err := s.Get(ctx, user, id)
	if err != nil {
		return err
	}
	for _, p := range grants {
		if !Has(st.Manifest.Permissions, p) {
			return errors.New("不能授予未声明权限")
		}
	}
	if enabled && st.Origin != "builtin" {
		for _, p := range st.Manifest.Permissions {
			if !Has(grants, p) {
				return errors.New("必须明确授予插件所需权限")
			}
		}
	}
	cfg, _ := json.Marshal(config)
	grant, _ := json.Marshal(grants)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if column := s.Policy.Preferences[id]; column != "" {
		if _, err = tx.ExecContext(ctx, "UPDATE user_preferences SET "+column+"=?,updated_at=datetime('now') WHERE user_id=?", enabled, user); err != nil {
			return err
		}
	}
	// 互斥组：启用一个成员时停用同组的其他成员，兜底成员保持原状。
	if group := s.Policy.Exclusive[id]; enabled && group != "" {
		others := []string{}
		for other, otherGroup := range s.Policy.Exclusive {
			if other != id && otherGroup == group && !s.Policy.Fallback[other] {
				others = append(others, other)
			}
		}
		sort.Strings(others)
		for _, other := range others {
			if column := s.Policy.Preferences[other]; column != "" {
				_, err = tx.ExecContext(ctx, "UPDATE user_preferences SET "+column+"=0,updated_at=datetime('now') WHERE user_id=?", user)
			} else {
				_, err = tx.ExecContext(ctx, `INSERT INTO plugin_users(user_id,plugin_id,enabled,config,grants) VALUES(?,?,0,'{}','[]') ON CONFLICT(user_id,plugin_id) DO UPDATE SET enabled=0,generation=plugin_users.generation+1`, user, other)
			}
			if err != nil {
				return err
			}
		}
	}
	if enabled {
		for _, contribution := range st.Manifest.Contributes {
			if contribution.Kind != "theme" && contribution.Kind != "background" {
				continue
			}
			if st.Origin == "builtin" {
				continue
			}
			states, e := tx.QueryContext(ctx, "SELECT v.manifest FROM plugin_installations i JOIN plugin_versions v ON v.plugin_id=i.plugin_id AND v.version=i.version WHERE i.plugin_id<>?", id)
			if e != nil {
				return e
			}
			conflicts := []string{}
			for states.Next() {
				var raw string
				if e = states.Scan(&raw); e != nil {
					states.Close()
					return e
				}
				var other Manifest
				if json.Unmarshal([]byte(raw), &other) != nil {
					continue
				}
				for _, c := range other.Contributes {
					if c.Kind == contribution.Kind {
						conflicts = append(conflicts, other.ID)
						break
					}
				}
			}
			e = states.Err()
			states.Close()
			if e != nil {
				return e
			}
			for _, other := range conflicts {
				if _, e = tx.ExecContext(ctx, "UPDATE plugin_users SET enabled=0,generation=generation+1 WHERE user_id=? AND plugin_id=?", user, other); e != nil {
					return e
				}
			}
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO plugin_users(user_id,plugin_id,enabled,config,grants) VALUES(?,?,?,?,?) ON CONFLICT(user_id,plugin_id) DO UPDATE SET enabled=excluded.enabled,config=excluded.config,grants=excluded.grants,generation=plugin_users.generation+1`, user, id, enabled, string(cfg), string(grant))
	if err != nil {
		return err
	}
	// 任意配置、授权或启停变化均使待确认操作失效。
	if _, err = tx.ExecContext(ctx, "DELETE FROM plugin_tool_confirmations WHERE user_id=? AND plugin_id=?", user, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM agent_pending_actions WHERE user_id=?", user); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO plugin_audit(user_id,plugin_id,operation) VALUES(?,?,'configure')", user, id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Install(ctx context.Context, user string, p *Package, source string, validate func(map[string]any, map[string]any) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	graph := map[string]Manifest{}
	for id, m := range s.Builtins {
		graph[id] = m
	}
	installed, e := tx.QueryContext(ctx, "SELECT v.manifest FROM plugin_installations i JOIN plugin_versions v ON v.plugin_id=i.plugin_id AND v.version=i.version")
	if e != nil {
		return e
	}
	for installed.Next() {
		var raw string
		if e = installed.Scan(&raw); e != nil {
			installed.Close()
			return e
		}
		var m Manifest
		if json.Unmarshal([]byte(raw), &m) == nil {
			graph[m.ID] = m
		}
	}
	e = installed.Err()
	installed.Close()
	if e != nil {
		return e
	}
	graph[p.Manifest.ID] = p.Manifest
	// 缺失依赖允许安装后等待，但已安装依赖的环必须在切换版本前拒绝。
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var cycle func(string) bool
	cycle = func(id string) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visiting[id] = true
		for dep := range graph[id].Dependencies {
			if _, ok := graph[dep]; ok && cycle(dep) {
				return true
			}
		}
		delete(visiting, id)
		visited[id] = true
		return false
	}
	for id := range graph {
		if cycle(id) {
			return errors.New("插件依赖存在循环")
		}
	}
	var old string
	err = tx.QueryRowContext(ctx, "SELECT version FROM plugin_installations WHERE plugin_id=?", p.Manifest.ID).Scan(&old)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if old == p.Manifest.Version {
		return errors.New("版本已安装；发布更新必须使用新版本")
	}
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT digest FROM plugin_versions WHERE plugin_id=? AND version=?", p.Manifest.ID, p.Manifest.Version).Scan(&existing)
	if err == nil && existing != p.Digest {
		return errors.New("禁止覆盖同版本的不同内容")
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	rows, err := tx.QueryContext(ctx, "SELECT config FROM plugin_users WHERE plugin_id=?", p.Manifest.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		var cfg map[string]any
		if json.Unmarshal([]byte(raw), &cfg) != nil {
			rows.Close()
			return errors.New("已有配置无效")
		}
		if p.Manifest.Settings != nil && validate(cfg, p.Manifest.Settings) != nil {
			rows.Close()
			return errors.New("新版本与已有配置不兼容，请先调整配置")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(p.Manifest)
	if _, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO plugin_versions(plugin_id,version,manifest,digest,archive,source) VALUES(?,?,?,?,?,?)", p.Manifest.ID, p.Manifest.Version, string(raw), p.Digest, p.Archive, source); err != nil {
		return err
	}
	if old != "" {
		if _, err = tx.ExecContext(ctx, "INSERT OR REPLACE INTO plugin_config_snapshots SELECT plugin_id,?,user_id,config,grants,enabled FROM plugin_users WHERE plugin_id=?", old, p.Manifest.ID); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO plugin_installations(plugin_id,version,previous_version) VALUES(?,?,NULLIF(?,'')) ON CONFLICT(plugin_id) DO UPDATE SET previous_version=plugin_installations.version,version=excluded.version,generation=plugin_installations.generation+1`, p.Manifest.ID, p.Manifest.Version, old); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM plugin_tool_confirmations WHERE plugin_id=?", p.Manifest.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE plugin_users SET exposed_tools='[]' WHERE plugin_id=?", p.Manifest.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM agent_pending_actions WHERE plugin_revision<>''"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO plugin_audit(user_id,plugin_id,operation) VALUES(?,?,'install')", user, p.Manifest.ID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Archive(ctx context.Context, id, version string) (*Package, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT archive FROM plugin_versions WHERE plugin_id=? AND version=?", id, version).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return ReadPackage(raw)
}
func (s *Store) Admin(ctx context.Context, user, id, action string) error {
	st, err := s.Get(ctx, user, id)
	if err != nil {
		return err
	}
	if st.Origin == "builtin" && (action == "uninstall" || action == "rollback") {
		return errors.New("内置插件不能删除或回滚")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	switch action {
	case "disable", "allow":
		_, err = tx.ExecContext(ctx, `INSERT INTO plugin_installations(plugin_id,version,disabled) VALUES(?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET disabled=excluded.disabled,generation=plugin_installations.generation+1`, id, st.Manifest.Version, action == "disable")
	case "uninstall":
		_, err = tx.ExecContext(ctx, "DELETE FROM plugin_installations WHERE plugin_id=?", id)
		if err == nil {
			_, err = tx.ExecContext(ctx, "DELETE FROM plugin_versions WHERE plugin_id=?", id)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, "UPDATE plugin_users SET enabled=0,generation=generation+1 WHERE plugin_id=?", id)
		}
	case "rollback":
		if st.Previous == "" {
			return errors.New("没有可回滚版本")
		}
		_, err = tx.ExecContext(ctx, "UPDATE plugin_installations SET version=previous_version,previous_version=version,generation=generation+1 WHERE plugin_id=?", id)
		// 回滚恢复配置，但不会恢复已撤销权限或重新启用插件。
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE plugin_users SET config=COALESCE((SELECT config FROM plugin_config_snapshots c WHERE c.plugin_id=plugin_users.plugin_id AND c.user_id=plugin_users.user_id AND c.version=?),config),generation=generation+1 WHERE plugin_id=?`, st.Previous, id)
		}
	default:
		return errors.New("未知维护操作")
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM plugin_tool_confirmations WHERE plugin_id=?", id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM agent_pending_actions"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO plugin_audit(user_id,plugin_id,operation) VALUES(?,?,?)", user, id, action); err != nil {
		return err
	}
	return tx.Commit()
}
