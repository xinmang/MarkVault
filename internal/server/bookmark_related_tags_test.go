package server

import (
	"net/url"
	"slices"
	"strings"
	"testing"
)

func TestBookmarkRelatedTags(t *testing.T) {
	f := setup(t)
	token, _ := f.account("related_tags")
	tags := map[string]string{}
	for key, name := range map[string]string{"tools": "工具", "linux": "Linux", "windows": "Windows", "docs": "文档", "orphan": "回收站标签", "removed": "已删除标签"} {
		tag := data(t, f.request("POST", "/api/v1/tags", token, object{"name": name}), 201)["tag"].(map[string]any)
		tags[key] = str(tag["id"])
	}
	create := func(name string, selected []string, extra object) string {
		t.Helper()
		body := object{"title": name, "url": "https://example.test/" + url.PathEscape(name), "tag_ids": selected, "is_public": true}
		for key, value := range extra {
			body[key] = value
		}
		bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, body), 201)["bookmark"].(map[string]any)
		return str(bookmark["id"])
	}
	newID := create("Windows 工具", []string{tags["tools"], tags["windows"], tags["removed"]}, object{"is_pinned": true})
	linuxID := create("Linux 100%_ 工具", []string{tags["tools"], tags["linux"]}, object{"is_public": false, "is_archived": true})
	create("工具文档", []string{tags["tools"], tags["docs"]}, nil)
	create("Linux 文档", []string{tags["linux"], tags["docs"]}, nil)
	trashID := create("回收站", []string{tags["tools"], tags["orphan"]}, nil)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+trashID, token, nil), 204)
	if _, err := f.db.Exec("UPDATE tags SET deleted_at='2026-10-22' WHERE id=?", tags["removed"]); err != nil {
		t.Fatal(err)
	}
	otherToken, _ := f.account("related_other")
	foreign := data(t, f.request("POST", "/api/v1/tags", otherToken, object{"name": "其他账号标签"}), 201)["tag"].(map[string]any)
	tags["foreign"] = str(foreign["id"])
	check(t, f.request("POST", "/api/v1/bookmarks", otherToken, object{"title": "其他账号", "url": "https://example.test/other", "tag_ids": []string{tags["foreign"]}}), 201)

	list := func(selected []string, filters url.Values) object {
		t.Helper()
		q := url.Values{"tags": {strings.Join(selected, ",")}, "page_size": {"1"}}
		for key, values := range filters {
			q[key] = values
		}
		return data(t, f.request("GET", "/api/v1/bookmarks?"+q.Encode(), token, nil), 200)
	}
	assertRelated := func(t *testing.T, result object, expected ...string) []string {
		t.Helper()
		meta := result["meta"].(map[string]any)
		values, ok := meta["related_tag_ids"].([]any)
		if !ok {
			t.Fatalf("待选标签必须为数组: %v", meta)
		}
		actual := []string{}
		for _, value := range values {
			actual = append(actual, str(value))
		}
		slices.Sort(expected)
		if !slices.Equal(actual, expected) {
			t.Fatalf("待选标签=%v，预期=%v", actual, expected)
		}
		return actual
	}

	t.Run("首屏包含后续分页的标签且翻页结果稳定", func(t *testing.T) {
		first := list([]string{tags["tools"]}, nil)
		rows := first["bookmarks"].([]any)
		if len(rows) != 1 || str(rows[0].(map[string]any)["id"]) != newID {
			t.Fatalf("首屏应只包含 Windows 书签: %v", rows)
		}
		assertRelated(t, first, tags["linux"], tags["windows"], tags["docs"])
		cursor := str(first["meta"].(map[string]any)["next_cursor"])
		assertRelated(t, list([]string{tags["tools"]}, url.Values{"page_cursor": {cursor}}), tags["linux"], tags["windows"], tags["docs"])
	})
	t.Run("多标签要求共同书签并返回空候选", func(t *testing.T) {
		result := list([]string{tags["tools"], tags["linux"]}, nil)
		rows := result["bookmarks"].([]any)
		if len(rows) != 1 || str(rows[0].(map[string]any)["id"]) != linuxID {
			t.Fatalf("工具与 Linux 应匹配一条书签: %v", rows)
		}
		assertRelated(t, result)
		empty := list([]string{tags["tools"], tags["linux"], tags["docs"]}, nil)
		if len(empty["bookmarks"].([]any)) != 0 {
			t.Fatal("两两共现不能替代三个标签同时匹配")
		}
		assertRelated(t, empty)
	})
	for _, tc := range []struct {
		name     string
		filters  url.Values
		expected []string
	}{
		{"全部", nil, []string{tags["linux"], tags["windows"], tags["docs"]}},
		{"搜索", url.Values{"keyword": {"100%_"}}, []string{tags["linux"]}},
		{"置顶", url.Values{"pinned": {"true"}}, []string{tags["windows"]}},
		{"归档", url.Values{"archived": {"true"}}, []string{tags["linux"]}},
		{"私有", url.Values{"public": {"false"}}, []string{tags["linux"]}},
		{"公开", url.Values{"public": {"true"}}, []string{tags["windows"], tags["docs"]}},
	} {
		t.Run(tc.name+"筛选下候选与追加标签后的结果一致", func(t *testing.T) {
			related := assertRelated(t, list([]string{tags["tools"]}, tc.filters), tc.expected...)
			for _, key := range []string{"linux", "windows", "docs", "orphan", "removed", "foreign"} {
				result := list([]string{tags["tools"], tags[key]}, tc.filters)
				hasBookmarks := len(result["bookmarks"].([]any)) > 0
				if slices.Contains(related, tags[key]) != hasBookmarks {
					t.Fatalf("%s 的候选状态与书签结果不一致", key)
				}
			}
		})
	}
	t.Run("未选择或选择已删除标签时返回空候选", func(t *testing.T) {
		assertRelated(t, list(nil, nil))
		assertRelated(t, list([]string{tags["removed"]}, nil))
	})
}
