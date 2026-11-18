package server

import (
	"strings"
	"testing"
)

func noteList(t *testing.T, value any) []any {
	t.Helper()
	list, ok := value.([]any)
	if !ok {
		t.Fatalf("备注列表格式错误: %v", value)
	}
	return list
}

func TestBookmarkNotesLifecycle(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	other, _ := f.account("bob")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "签到站", "url": "https://checkin.example/", "description": "每日签到"}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	if number(bookmark["note_count"]) != 0 || len(noteList(t, bookmark["notes"])) != 0 {
		t.Fatalf("新书签不应有备注: %v", bookmark)
	}
	base := "/api/v1/bookmarks/" + bid + "/notes"
	check(t, f.request("POST", base, token, object{"content": "   "}), 400)
	check(t, f.request("POST", base, token, object{"content": strings.Repeat("长", maxNoteRunes+1)}), 400)
	check(t, f.request("POST", base, token, object{"content": "x", "source": "agent"}), 400)
	check(t, f.request("POST", base, other, object{"content": "越权"}), 404)
	first := data(t, f.request("POST", base, token, object{"content": "  必须登录后才能访问  "}), 201)["note"].(map[string]any)
	if first["content"] != "必须登录后才能访问" || first["source"] != "user" || first["is_pinned"] != false || first["bookmark_id"] != bid {
		t.Fatalf("备注内容错误: %v", first)
	}
	if _, ok := first["tab_item_id"]; ok {
		t.Fatalf("书签备注不应带标签页 ID: %v", first)
	}
	pinned := data(t, f.request("POST", base, token, object{"content": "反爬严格，间隔 5 秒以上", "is_pinned": true}), 201)["note"].(map[string]any)
	data(t, f.request("POST", base, token, object{"content": strings.Repeat("签到成功 ", 60)}), 201)
	data(t, f.request("POST", base, token, object{"content": "第四条"}), 201)

	// 列表只带预览：置顶在前，最多 3 条，过长内容被截断；备注数量是完整数量。
	rows := data(t, f.request("GET", "/api/v1/bookmarks", token, nil), 200)["bookmarks"].([]any)
	row := rows[0].(map[string]any)
	preview := noteList(t, row["notes"])
	if number(row["note_count"]) != 4 || len(preview) != notePreviewCount {
		t.Fatalf("备注预览数量错误: %v", row)
	}
	if preview[0].(map[string]any)["id"] != pinned["id"] {
		t.Fatalf("置顶备注应排在最前: %v", preview)
	}
	clipped := false
	for _, item := range preview {
		note := item.(map[string]any)
		if note["truncated"] == true {
			clipped = true
			if len([]rune(str(note["content"]))) != notePreviewRunes+1 {
				t.Fatalf("预览截断长度错误: %d", len([]rune(str(note["content"]))))
			}
		}
	}
	if !clipped {
		t.Fatal("过长的备注在列表中未截断")
	}
	// 详情带完整备注。
	detail := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"].(map[string]any)
	if len(noteList(t, detail["notes"])) != 4 || strings.Contains(stringMustJSON(detail["notes"]), "truncated") {
		t.Fatalf("书签详情应带完整备注: %v", detail["notes"])
	}
	// 关键词和搜索都能命中备注，描述与备注互不影响。
	if found := data(t, f.request("GET", "/api/v1/bookmarks?keyword=%E5%8F%8D%E7%88%AC", token, nil), 200)["bookmarks"].([]any); len(found) != 1 {
		t.Fatal("关键词未匹配备注")
	}
	if found := data(t, f.request("GET", "/api/v1/search?q=%E5%BF%85%E9%A1%BB%E7%99%BB%E5%BD%95", token, nil), 200)["results"].(map[string]any)["bookmarks"].([]any); len(found) != 1 {
		t.Fatal("搜索未匹配备注")
	}
	if detail["description"] != "每日签到" {
		t.Fatal("备注改动了描述")
	}

	// 分页列表。
	listed := data(t, f.request("GET", base+"?page_size=2", token, nil), 200)
	meta := listed["meta"].(map[string]any)
	if len(noteList(t, listed["notes"])) != 2 || meta["has_more"] != true || number(meta["total"]) != 4 || meta["next_cursor"] != "2" {
		t.Fatalf("备注分页错误: %v", listed)
	}
	check(t, f.request("GET", base, other, nil), 404)

	// 修改与置顶：只切换置顶不更新修改时间。
	path := "/api/v1/notes/" + str(first["id"])
	check(t, f.request("PATCH", path, other, object{"content": "越权"}), 404)
	check(t, f.request("PATCH", path, token, object{}), 400)
	toggled := data(t, f.request("PATCH", path, token, object{"is_pinned": true}), 200)["note"].(map[string]any)
	if toggled["is_pinned"] != true || toggled["updated_at"] != first["updated_at"] {
		t.Fatalf("置顶不应改变修改时间: %v", toggled)
	}
	edited := data(t, f.request("PATCH", path, token, object{"content": "需要登录，支持通行密钥"}), 200)["note"].(map[string]any)
	if edited["content"] != "需要登录，支持通行密钥" {
		t.Fatalf("备注修改失败: %v", edited)
	}
	check(t, f.request("DELETE", path, other, nil), 404)
	check(t, f.request("DELETE", path, token, nil), 204)
	check(t, f.request("DELETE", path, token, nil), 404)

	// 回收站里的书签保留备注但不能追加；永久删除后备注一并清除。
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, token, nil), 204)
	check(t, f.request("POST", base, token, object{"content": "回收站"}), 404)
	if number(data(t, f.request("GET", base, token, nil), 200)["meta"].(map[string]any)["total"]) != 3 {
		t.Fatal("移入回收站后备注丢失")
	}
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/permanent", token, nil), 204)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM notes").Scan(&count); err != nil || count != 0 {
		t.Fatalf("永久删除书签后仍有 %d 条备注: %v", count, err)
	}
}

func TestTabItemNotes(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	other, _ := f.account("bob")
	group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "工作", "items": []object{{"title": "后台", "url": "https://admin.example/"}}}), 201)["tab_group"].(map[string]any)
	gid := str(group["id"])
	item := group["items"].([]any)[0].(map[string]any)
	if number(item["note_count"]) != 0 {
		t.Fatalf("新标签页不应有备注: %v", item)
	}
	base := "/api/v1/tab-groups/items/" + str(item["id"]) + "/notes"
	check(t, f.request("POST", base, other, object{"content": "越权"}), 404)
	note := data(t, f.request("POST", base, token, object{"content": "只能在公司网络访问"}), 201)["note"].(map[string]any)
	if note["tab_item_id"] != item["id"] || note["source"] != "user" {
		t.Fatalf("标签页备注错误: %v", note)
	}
	if _, ok := note["bookmark_id"]; ok {
		t.Fatalf("标签页备注不应带书签 ID: %v", note)
	}
	for _, path := range []string{"/api/v1/tab-groups", "/api/v1/tab-groups/" + gid} {
		body := data(t, f.request("GET", path, token, nil), 200)
		if !strings.Contains(stringMustJSON(body), "只能在公司网络访问") || !strings.Contains(stringMustJSON(body), `"note_count":1`) {
			t.Fatalf("%s 未返回标签页备注: %v", path, body)
		}
	}
	updated := data(t, f.request("PATCH", "/api/v1/tab-groups/items/"+str(item["id"]), token, object{"is_todo": true}), 200)["item"].(map[string]any)
	if number(updated["note_count"]) != 1 {
		t.Fatalf("修改标签页后丢失备注数量: %v", updated)
	}
	// 分享链接是匿名访问，不能带出备注。
	share := data(t, f.request("POST", "/api/v1/tab-groups/"+gid+"/share", token, object{"is_public": true}), 200)
	public := stringMustJSON(data(t, f.request("GET", "/api/share/"+str(share["share_token"]), "", nil), 200))
	if strings.Contains(public, "note") || strings.Contains(public, "公司网络") {
		t.Fatalf("分享链接泄漏备注: %s", public)
	}
	// 组在回收站时不能再追加；删除标签页后备注一并清除。
	check(t, f.request("DELETE", "/api/v1/tab-groups/"+gid, token, nil), 204)
	check(t, f.request("POST", base, token, object{"content": "回收站"}), 404)
	check(t, f.request("POST", "/api/v1/tab-groups/"+gid+"/restore", token, nil), 200)
	check(t, f.request("DELETE", "/api/v1/tab-groups/items/"+str(item["id"]), token, nil), 204)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM notes").Scan(&count); err != nil || count != 0 {
		t.Fatalf("删除标签页后仍有 %d 条备注: %v", count, err)
	}
}

func TestPublicBookmarksHideNotes(t *testing.T) {
	f := setup(t)
	token, _ := f.account("publisher")
	check(t, f.request("PUT", "/api/v1/settings/share", token, object{"enabled": true, "slug": "memo-public"}), 200)
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "公开", "url": "https://public.example/", "is_public": true}), 201)["bookmark"].(map[string]any)
	data(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/notes", token, object{"content": "账号密码在密码管理器里"}), 201)
	for _, path := range []string{"/api/public/memo-public", "/api/public/memo-public?page_size=10"} {
		public := f.request("GET", path, "", nil)
		if public.Code != 200 || strings.Contains(public.Body.String(), "note") || strings.Contains(public.Body.String(), "密码管理器") {
			t.Fatalf("公开页泄漏备注: %s", public.Body.String())
		}
	}
}

func TestNotePermissionsAndSource(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	newKey := func(name string, permissions ...string) string {
		return str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": name, "permissions": permissions}), 201)["key"])
	}
	check(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "无效", "permissions": []string{"tags.note"}}), 400)
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "签到站", "url": "https://checkin.example/"}), 201)["bookmark"].(map[string]any)
	base := "/api/v1/agent/bookmarks/" + str(bookmark["id"]) + "/notes"
	mine := data(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/notes", token, object{"content": "本人记录"}), 201)["note"].(map[string]any)

	readonly := newKey("只读", "bookmarks.read")
	check(t, f.request("GET", base, readonly, nil), 200)
	check(t, f.request("POST", base, readonly, object{"content": "越权"}), 403)

	// 只有追加权限：可以写、看不到内容、不能改写或删除已有备注。
	writer := newKey("签到脚本", "bookmarks.note")
	check(t, f.request("GET", base, writer, nil), 403)
	blind := data(t, f.request("POST", base, writer, object{"content": "2026-11-18 签到成功"}), 201)["note"].(map[string]any)
	if len(blind) != 1 || blind["id"] == nil {
		t.Fatalf("没有读取权限时只应返回备注 ID: %v", blind)
	}
	check(t, f.request("PATCH", "/api/v1/agent/notes/"+str(mine["id"]), writer, object{"content": "篡改"}), 403)
	check(t, f.request("DELETE", "/api/v1/agent/notes/"+str(mine["id"]), writer, nil), 403)
	check(t, f.request("DELETE", "/api/v1/agent/notes/missing", writer, nil), 403)

	agent := newKey("每日签到 Agent", "bookmarks.read", "bookmarks.note")
	recorded := data(t, f.request("POST", base, agent, object{"content": "2026-11-19 签到失败：验证码"}), 201)["note"].(map[string]any)
	if recorded["source"] != "agent" || recorded["source_name"] != "每日签到 Agent" {
		t.Fatalf("Agent 备注来源错误: %v", recorded)
	}
	check(t, f.request("PATCH", "/api/v1/agent/notes/"+str(recorded["id"]), agent, object{"is_pinned": true}), 403)
	// 持有同一个 Key 的调用方换用兼容路径，仍然标记为该 Agent。
	extension := data(t, f.request("POST", "/api/tab/bookmarks/"+str(bookmark["id"])+"/notes", agent, object{"content": "扩展里记的"}), 201)["note"].(map[string]any)
	if extension["source"] != "agent" || extension["source_name"] != "每日签到 Agent" {
		t.Fatalf("扩展备注来源错误: %v", extension)
	}

	editor := newKey("整理", "bookmarks.update")
	check(t, f.request("PATCH", "/api/v1/agent/notes/"+str(recorded["id"]), editor, object{"is_pinned": true}), 200)
	check(t, f.request("DELETE", "/api/v1/agent/notes/missing", editor, nil), 404)
	check(t, f.request("DELETE", "/api/v1/agent/notes/"+str(recorded["id"]), editor, nil), 204)

	// 标签页备注使用标签页组的权限，书签权限不能越界。
	group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "工作", "items": []object{{"title": "后台", "url": "https://admin.example/"}}}), 201)["tab_group"].(map[string]any)
	item := str(group["items"].([]any)[0].(map[string]any)["id"])
	tabBase := "/api/v1/agent/tab-groups/items/" + item + "/notes"
	check(t, f.request("POST", tabBase, agent, object{"content": "越权"}), 403)
	tabNote := data(t, f.request("POST", "/api/v1/tab-groups/items/"+item+"/notes", token, object{"content": "本人记录"}), 201)["note"].(map[string]any)
	check(t, f.request("DELETE", "/api/v1/agent/notes/"+str(tabNote["id"]), editor, nil), 403)
	tabAgent := newKey("标签页", "tab_groups.read", "tab_groups.note")
	if got := data(t, f.request("POST", tabBase, tabAgent, object{"content": "需要 VPN"}), 201)["note"].(map[string]any); got["source"] != "agent" {
		t.Fatalf("标签页 Agent 备注来源错误: %v", got)
	}

	// BASIC 模板包含追加书签备注的权限。
	basic := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "基础", "template": "BASIC"}), 201)
	if !strings.Contains(stringMustJSON(basic["permissions"]), "bookmarks.note") {
		t.Fatalf("BASIC 模板缺少备注权限: %v", basic["permissions"])
	}
}

func TestMCPNoteTools(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "签到站", "url": "https://checkin.example/"}), 201)["bookmark"].(map[string]any)
	group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "工作", "items": []object{{"title": "后台", "url": "https://admin.example/"}}}), 201)["tab_group"].(map[string]any)
	item := str(group["items"].([]any)[0].(map[string]any)["id"])
	key := str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "签到 Agent", "permissions": []string{"bookmarks.read", "bookmarks.note", "tab_groups.read"}}), 201)["key"])
	call := func(name string, args object) map[string]any {
		t.Helper()
		response := check(t, f.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": object{"name": name, "arguments": args}}), 200)
		return response["result"].(map[string]any)
	}
	listed := stringMustJSON(check(t, f.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}), 200))
	for _, name := range []string{"markvault_list_bookmark_notes", "markvault_add_bookmark_note", "markvault_list_tab_groups", "markvault_list_tab_notes"} {
		if !strings.Contains(listed, name) {
			t.Fatalf("工具列表缺少 %s", name)
		}
	}
	if strings.Contains(listed, "markvault_add_tab_note") {
		t.Fatal("没有标签页备注权限的密钥暴露了写工具")
	}
	args := object{"id": bookmark["id"], "content": "2026-11-18 签到成功，获得 5 积分"}
	if call("markvault_add_bookmark_note", args)["isError"] != true {
		t.Fatal("未确认的备注被写入")
	}
	args["confirm"] = true
	added := call("markvault_add_bookmark_note", args)
	if added["isError"] != false {
		t.Fatalf("MCP 添加备注失败: %v", added)
	}
	note := added["structuredContent"].(map[string]any)["note"].(map[string]any)
	if note["source"] != "agent" || note["source_name"] != "签到 Agent" {
		t.Fatalf("MCP 备注来源错误: %v", note)
	}
	notes := call("markvault_list_bookmark_notes", object{"id": bookmark["id"], "page_size": 10})["structuredContent"].(map[string]any)
	if len(noteList(t, notes["notes"])) != 1 || number(notes["meta"].(map[string]any)["page_size"]) != 10 {
		t.Fatalf("MCP 读取备注失败: %v", notes)
	}
	detail := call("markvault_get_bookmark", object{"id": bookmark["id"]})["structuredContent"].(map[string]any)["bookmark"].(map[string]any)
	if number(detail["note_count"]) != 1 {
		t.Fatalf("书签详情缺少备注: %v", detail)
	}
	if found := call("markvault_search", object{"query": "5 积分"})["structuredContent"].(map[string]any)["results"].(map[string]any)["bookmarks"].([]any); len(found) != 1 {
		t.Fatal("MCP 搜索未匹配备注")
	}
	if call("markvault_add_tab_note", object{"id": item, "content": "越权", "confirm": true})["isError"] != true {
		t.Fatal("缺少权限的密钥写入了标签页备注")
	}
	groups := call("markvault_list_tab_groups", object{})["structuredContent"].(map[string]any)["tab_groups"].([]any)
	if len(groups) != 1 || groups[0].(map[string]any)["items"].([]any)[0].(map[string]any)["id"] != item {
		t.Fatalf("MCP 列出标签页组失败: %v", groups)
	}
	if call("markvault_list_tab_notes", object{"id": item})["isError"] != false {
		t.Fatal("MCP 读取标签页备注失败")
	}
}

func TestNotesImportExportRoundTrip(t *testing.T) {
	f := setup(t)
	token, _ := f.account("backup")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "签到站", "url": "https://checkin.example/"}), 201)["bookmark"].(map[string]any)
	data(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/notes", token, object{"content": "反爬严格", "is_pinned": true}), 201)
	group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "工作", "items": []object{{"title": "后台", "url": "https://admin.example/"}}}), 201)["tab_group"].(map[string]any)
	item := str(group["items"].([]any)[0].(map[string]any)["id"])
	data(t, f.request("POST", "/api/v1/tab-groups/items/"+item+"/notes", token, object{"content": "需要 VPN"}), 201)
	exported := check(t, f.request("GET", "/api/v1/export", token, nil), 200)
	exportedBookmark := exported["bookmarks"].([]any)[0].(map[string]any)
	exportedNote := noteList(t, exportedBookmark["notes"])[0].(map[string]any)
	if exportedNote["content"] != "反爬严格" || exportedNote["is_pinned"] != true || exportedNote["id"] != nil {
		t.Fatalf("导出的书签备注错误: %v", exportedNote)
	}
	if _, ok := exportedBookmark["note_count"]; ok {
		t.Fatal("导出不应包含 note_count")
	}
	exportedItem := exported["tab_groups"].([]any)[0].(map[string]any)["items"].([]any)[0].(map[string]any)
	if _, ok := exportedItem["note_count"]; ok || noteList(t, exportedItem["notes"])[0].(map[string]any)["content"] != "需要 VPN" {
		t.Fatalf("导出的标签页备注错误: %v", exportedItem)
	}

	other, _ := f.account("restore")
	for range 2 {
		// 第二次用覆盖模式重复导入，不能产生重复备注。
		check(t, f.request("POST", "/api/v1/import?skip_duplicates=false", other, exported), 200)
	}
	restored := data(t, f.request("GET", "/api/v1/bookmarks", other, nil), 200)["bookmarks"].([]any)[0].(map[string]any)
	restoredNotes := noteList(t, restored["notes"])
	if len(restoredNotes) != 1 || number(restored["note_count"]) != 1 {
		t.Fatalf("导入后书签备注数量错误: %v", restored)
	}
	restoredNote := restoredNotes[0].(map[string]any)
	if restoredNote["content"] != "反爬严格" || restoredNote["is_pinned"] != true || restoredNote["created_at"] != exportedNote["created_at"] {
		t.Fatalf("导入后的书签备注错误: %v", restoredNote)
	}
	groups := stringMustJSON(data(t, f.request("GET", "/api/v1/tab-groups", other, nil), 200))
	if !strings.Contains(groups, "需要 VPN") {
		t.Fatalf("导入后缺少标签页备注: %s", groups)
	}
}

func TestImportNoteLimitRollsBackMerge(t *testing.T) {
	f := setup(t)
	token, _ := f.account("limit")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "原始标题", "url": "https://limit.example"}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	// 构造已满的书签，不经过一千次 HTTP 追加请求。
	_, err := f.db.Exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
		INSERT INTO notes(id,user_id,bookmark_id,content,created_at,updated_at)
		SELECT 'n'||n,b.user_id,b.id,'记录'||n,b.created_at,b.updated_at FROM bookmarks b,seq WHERE b.id=?`, maxNotesPerTarget, bid)
	if err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/bookmarks/" + bid + "/notes"
	check(t, f.request("POST", base, token, object{"content": "额外一条"}), 400)
	backup := object{"format": "markvault", "tags": []object{}, "bookmarks": []object{{"title": "不应保留", "url": bookmark["url"], "notes": []object{{"content": "导入的一条"}}}}}
	check(t, f.request("POST", "/api/v1/import?skip_duplicates=false", token, backup), 400)
	after := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"].(map[string]any)
	if after["title"] != bookmark["title"] || number(after["note_count"]) != maxNotesPerTarget || len(noteList(t, after["notes"])) != noteDetailCount {
		t.Fatal("导入超过上限时应回滚，详情只返回前 50 条")
	}
}
