package server

import (
	"strconv"
	"testing"
)

// 旧实现：标签页组列表按 created_at 倒序，回收站按 deleted_at 倒序。
func TestGroupListOrderMatchesLegacy(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	ids := []string{}
	for i := 1; i <= 3; i++ {
		group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "组" + strconv.Itoa(i)}), 201)["tab_group"].(map[string]any)
		ids = append(ids, str(group["id"]))
		if _, err := f.db.Exec("UPDATE tab_groups SET created_at=? WHERE id=?", "2024-01-0"+strconv.Itoa(i)+"T00:00:00.000Z", ids[i-1]); err != nil {
			t.Fatal(err)
		}
	}
	titles := func(list []any) []string {
		result := []string{}
		for _, row := range list {
			result = append(result, str(row.(map[string]any)["title"]))
		}
		return result
	}
	live := data(t, f.request("GET", "/api/v1/tab-groups", token, nil), 200)["tab_groups"].([]any)
	if got := titles(live); len(got) != 3 || got[0] != "组3" || got[2] != "组1" {
		t.Fatalf("列表未按创建时间倒序: %v", got)
	}
	for i, gid := range ids {
		check(t, f.request("DELETE", "/api/v1/tab-groups/"+gid, token, nil), 204)
		if _, err := f.db.Exec("UPDATE tab_groups SET deleted_at=? WHERE id=?", "2024-02-0"+strconv.Itoa(3-i)+"T00:00:00.000Z", gid); err != nil {
			t.Fatal(err)
		}
	}
	trash := data(t, f.request("GET", "/api/v1/tab-groups/trash", token, nil), 200)["tab_groups"].([]any)
	if got := titles(trash); len(got) != 3 || got[0] != "组1" || got[2] != "组3" {
		t.Fatalf("回收站未按删除时间倒序: %v", got)
	}
}
