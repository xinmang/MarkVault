package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"markvault/internal/config"
	"markvault/internal/database"
	"markvault/internal/server"
	"markvault/plugins"
)

func main() {
	if err := run(); err != nil {
		slog.Error("服务启动失败", "error", err)
		os.Exit(1)
	}
}
func run() error {
	migrateOnly := flag.Bool("migrate", false, "执行数据库迁移后退出")
	healthcheck := flag.Bool("healthcheck", false, "检查当前实例的 HTTP 健康状态后退出")
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *healthcheck {
		_, port, err := net.SplitHostPort(cfg.Address)
		if err != nil {
			return err
		}
		client := &http.Client{Timeout: 3 * time.Second}
		response, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + "/api/v1/health")
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("健康检查失败: HTTP %d", response.StatusCode)
		}
		return nil
	}
	if err := cfg.PrepareSecrets(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, filepath.Join(cfg.DataDir, "database", "markvault.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		return err
	}
	if *migrateOnly {
		slog.Info("数据库迁移完成")
		return nil
	}
	handler := server.New(db, cfg, slog.Default(), plugins.Bundle())
	defer handler.Close()
	srv := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	result := make(chan error, 1)
	go func() {
		slog.Info("MarkVault Go 服务启动", "address", cfg.Address, "data", cfg.DataDir)
		result <- srv.ListenAndServe()
	}()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("HTTP 服务: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			_ = srv.Close()
			return err
		}
		return nil
	}
}
