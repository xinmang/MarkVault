package main

import (
	"archive/zip"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"markvault/internal/plugin"
)

// 打包工具不安装依赖、不执行生命周期脚本，只收集显式目录内的普通文件。
func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "用法: markvault-plugin validate <manifest.json> | pack <目录> <输出.zip>")
		os.Exit(1)
	}
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	switch args[0] {
	case "validate":
		raw, err := os.ReadFile(args[1])
		if err != nil {
			return err
		}
		m, err := plugin.ParseManifest(raw)
		if err == nil {
			fmt.Println(m.ID, m.Version, "清单有效")
		}
		return err
	case "pack":
		if len(args) != 3 {
			return fmt.Errorf("缺少输出路径")
		}
		root, err := filepath.Abs(args[1])
		if err != nil {
			return err
		}
		out, err := filepath.Abs(args[2])
		if err != nil {
			return err
		}
		names := []string{}
		err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("不允许符号链接")
			}
			if d.IsDir() {
				return nil
			}
			if path == out {
				return fmt.Errorf("输出不能位于插件源目录")
			}
			rel, _ := filepath.Rel(root, path)
			if !plugin.SafePath(filepath.ToSlash(rel)) {
				return fmt.Errorf("不安全的打包路径")
			}
			names = append(names, rel)
			return nil
		})
		if err != nil {
			return err
		}
		sort.Strings(names)
		file, err := os.CreateTemp(filepath.Dir(out), "plugin-*.zip")
		if err != nil {
			return err
		}
		temp := file.Name()
		defer os.Remove(temp)
		z := zip.NewWriter(file)
		for _, name := range names {
			raw, e := os.ReadFile(filepath.Join(root, name))
			if e != nil {
				z.Close()
				file.Close()
				return e
			}
			w, e := z.Create(filepath.ToSlash(name))
			if e == nil {
				_, e = w.Write(raw)
			}
			if e != nil {
				z.Close()
				file.Close()
				return e
			}
		}
		if err = z.Close(); err != nil {
			file.Close()
			return err
		}
		if err = file.Close(); err != nil {
			return err
		}
		raw, err := os.ReadFile(temp)
		if err != nil {
			return err
		}
		p, err := plugin.ReadPackage(raw)
		if err != nil {
			return err
		}
		if err = os.WriteFile(out, raw, 0600); err != nil {
			return err
		}
		fmt.Println(p.Manifest.ID, p.Manifest.Version, p.Digest)
		return nil
	}
	return fmt.Errorf("未知命令")
}
