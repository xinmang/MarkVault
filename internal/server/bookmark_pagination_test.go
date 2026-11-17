package server

import (
	"net/url"
	"testing"
)

func TestBookmarkPaginationPreferences(t *testing.T) {
	f := setup(t)
	token, _ := f.account("pagination")
	preferences := data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	for key, expected := range map[string]float64{"page_size": 30, "bookmark_initial_count": 30, "bookmark_load_more_expiry_minutes": 5} {
		if preferences[key] != expected {
			t.Fatalf("默认偏好 %s=%v，预期 %v", key, preferences[key], expected)
		}
	}
	updates := object{"page_size": 100, "bookmark_initial_count": 20, "bookmark_load_more_expiry_minutes": 10}
	check(t, f.request("PATCH", "/api/v1/preferences", token, updates), 200)
	preferences = data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	for key, expected := range updates {
		if preferences[key] != float64(expected.(int)) {
			t.Fatalf("偏好 %s 未持久化: %v", key, preferences[key])
		}
	}
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"bookmark_initial_count": 1, "page_size": 200, "bookmark_load_more_expiry_minutes": 0}), 200)
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"bookmark_initial_count": 200, "page_size": 1, "bookmark_load_more_expiry_minutes": 1440}), 200)
}

func TestBookmarkPaginationPreferenceValidationIsAtomic(t *testing.T) {
	f := setup(t)
	token, _ := f.account("validation")
	for key, values := range map[string][]any{
		"bookmark_initial_count":            {0, 201, 1.5, "30", nil},
		"page_size":                         {0, 201, 1.5, "30", nil},
		"bookmark_load_more_expiry_minutes": {-1, 1441, 1.5, "5", nil},
	} {
		for _, value := range values {
			check(t, f.request("PATCH", "/api/v1/preferences", token, object{key: value, "search_auto_clear_seconds": 60}), 400)
		}
	}
	preferences := data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if preferences["search_auto_clear_seconds"] == float64(60) || preferences["bookmark_initial_count"] != float64(30) {
		t.Fatalf("非法设置导致部分写入: %v", preferences)
	}
}

func TestBookmarkCursorAllowsDifferentLoadSizes(t *testing.T) {
	f := setup(t)
	token, _ := f.account("cursor_sizes")
	for _, suffix := range []string{"1", "2", "3", "4", "5", "6", "7"} {
		check(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": suffix, "url": "https://example.com/" + suffix}), 201)
	}
	cursor := ""
	seen := map[string]bool{}
	for index, size := range []string{"2", "3", "3"} {
		path := "/api/v1/bookmarks?sort=created&page_size=" + size
		if cursor != "" {
			path += "&page_cursor=" + url.QueryEscape(cursor)
		}
		response := data(t, f.request("GET", path, token, nil), 200)
		bookmarks := response["bookmarks"].([]any)
		expected := []int{2, 3, 2}[index]
		if len(bookmarks) != expected {
			t.Fatalf("第 %d 批数量=%d，预期=%d", index, len(bookmarks), expected)
		}
		for _, item := range bookmarks {
			id := str(item.(map[string]any)["id"])
			if seen[id] {
				t.Fatalf("书签重复: %s", id)
			}
			seen[id] = true
		}
		meta := response["meta"].(map[string]any)
		if meta["has_more"] != (index < 2) {
			t.Fatalf("第 %d 批 has_more 错误: %v", index, meta)
		}
		cursor = str(meta["next_cursor"])
	}
	if len(seen) != 7 {
		t.Fatalf("游标遗漏书签: %d", len(seen))
	}
}
