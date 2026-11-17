package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"markvault/internal/legacy"
)

func main() {
	source := flag.String("source", "", "原版数据目录，包含 database、storage、config")
	destination := flag.String("destination", "", "迁移目标目录，必须尚不存在")
	flag.Parse()
	if *source == "" || *destination == "" {
		flag.Usage()
		os.Exit(2)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	report, err := legacy.Import(ctx, *source, *destination)
	if err != nil {
		fmt.Fprintln(os.Stderr, "数据迁移失败:", err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, "输出迁移报告失败:", err)
		os.Exit(1)
	}
}
