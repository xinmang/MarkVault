package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"markvault/internal/plugin"
	"net/url"
	"strings"
)

func Tools() []plugin.Tool {
	var definitions []plugin.Tool
	if err := json.Unmarshal(AgentToolsJSON, &definitions); err != nil {
		panic(err)
	}
	return definitions
}
func FindTool(name string) (plugin.Tool, bool) {
	for _, definition := range Tools() {
		if definition.Name == name {
			return definition, true
		}
	}
	return plugin.Tool{}, false
}
func RunTool(name string, args object) (plugin.BusinessRequest, error) {
	body := object{}
	for key, value := range args {
		if key != "id" && key != "confirm" {
			body[key] = value
		}
	}
	query := url.Values{}
	identifier := str(args["id"])
	var operation string
	switch name {
	case "markvault_get_account":
		operation = "me"
	case "markvault_search":
		query.Set("q", str(args["query"]))
		if v, ok := args["limit"]; ok {
			query.Set("limit", fmt.Sprint(v))
		}
		operation = "search"
	case "markvault_list_bookmarks":
		for key, value := range args {
			if key == "tag_ids" {
				ids, _ := value.([]any)
				for _, v := range ids {
					query.Set("tags", strings.Trim(strings.Join(append(strings.Split(query.Get("tags"), ","), str(v)), ","), ","))
				}
			} else {
				query.Set(key, fmt.Sprint(value))
			}
		}
		operation = "listBookmarks"
	case "markvault_get_bookmark":
		operation = "getBookmark"
	case "markvault_create_bookmark":
		operation = "createBookmark"
	case "markvault_update_bookmark":
		operation = "updateBookmark"
	case "markvault_delete_bookmark":
		operation = "deleteBookmark"
	case "markvault_restore_bookmark":
		operation = "restoreBookmark"
	case "markvault_list_tags":
		operation = "listTags"
	case "markvault_get_tag":
		operation = "getTag"
	case "markvault_create_tag":
		operation = "createTag"
	case "markvault_update_tag":
		operation = "updateTag"
	case "markvault_delete_tag":
		operation = "deleteTag"
	case "markvault_list_bookmark_notes", "markvault_list_tab_groups", "markvault_list_tab_notes":
		// 分页参数走查询串，与 REST 接口一致。
		for key, value := range body {
			query.Set(key, fmt.Sprint(value))
		}
		operation = map[string]string{"markvault_list_bookmark_notes": "listBookmarkNotes", "markvault_list_tab_groups": "listGroups", "markvault_list_tab_notes": "listTabNotes"}[name]
	case "markvault_add_bookmark_note":
		operation = "createBookmarkNote"
	case "markvault_add_tab_note":
		operation = "createTabNote"
	default:
		return plugin.BusinessRequest{}, errors.New("未知工具")
	}
	return plugin.BusinessRequest{Operation: operation, Body: body, Query: query, ID: identifier}, nil
}
