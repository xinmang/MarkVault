#!/usr/bin/env node
// MarkVault 的 Go 开发/构建入口。
// 本脚本只负责在开发机或 CI 中调用 Go 工具链，自身不提供任何 HTTP 服务。

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const forwardedSignals = ["SIGINT", "SIGTERM"];

loadDotEnv();
const goCommand = resolveGoCommand();
main();

function main() {
  const subcommand = process.argv[2];
  const extraArgs = process.argv.slice(3);

  switch (subcommand) {
    case "run":
      runGo(["run", "./cmd/markvault", ...extraArgs]);
      break;
    case "migrate":
      runGo(["run", "./cmd/markvault", "-migrate", ...extraArgs]);
      break;
    case "test":
      // 附加参数按 go 命令参数处理，必须放在包路径之前，例如 go test -race ./...
      runGo(["test", ...extraArgs, "./..."]);
      break;
    case "build":
      build(extraArgs);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

// 读取仓库根目录的 .env：进程已有环境变量优先，文件不存在时静默忽略。
function loadDotEnv() {
  if (typeof process.loadEnvFile !== "function") {
    console.error("当前 Node.js 版本不支持读取 .env，请升级到 Node.js 22 或更新版本。");
    process.exit(1);
  }

  const envFile = join(repoRoot, ".env");
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    console.error("读取 .env 失败：" + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
}

// 优先使用 PATH 中的 go；Windows 缺少时回退到仓库内置工具链。
function resolveGoCommand() {
  const probe = spawnSync("go", ["version"], { stdio: "ignore", windowsHide: true });
  if (!probe.error) return "go";

  if (process.platform === "win32") {
    const fallback = join(repoRoot, ".data", "tools", "go", "bin", "go.exe");
    if (existsSync(fallback)) return fallback;
  }

  console.error("未找到可用的 go 命令：请把 Go 加入 PATH，或在 Windows 下使用仓库内置的 .data/tools/go/bin/go.exe。");
  process.exit(1);
}

function runGo(args) {
  const child = spawnGo(args);
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error("go 进程被信号 " + signal + " 终止");
      process.exitCode = 1;
      return;
    }
    process.exitCode = code === null ? 1 : code;
  });
}

function build(extraArgs) {
  const outDir = join(repoRoot, "build");
  mkdirSync(outDir, { recursive: true });
  const suffix = process.platform === "win32" ? ".exe" : "";
  const targets = [
    { name: "markvault", pkg: "./cmd/markvault" },
    { name: "markvault-migrate", pkg: "./cmd/markvault-migrate" },
  ];

  // 附加参数同样是 go build 的标志，放在包路径之前：go build -race -o out ./cmd/...
  const commands = targets.map((target) => [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    join(outDir, target.name + suffix),
    ...extraArgs,
    target.pkg,
  ]);

  runSequence(commands);
}

// 依次执行多条 go 命令，前一条成功后才会继续。
function runSequence(commands) {
  const [current, ...rest] = commands;
  if (!current) return;

  const child = spawnGo(current);
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error("go 进程被信号 " + signal + " 终止");
      process.exitCode = 1;
      return;
    }
    if (code !== 0) {
      process.exitCode = code === null ? 1 : code;
      return;
    }
    runSequence(rest);
  });
}

// 用参数数组调用 go，不经过 shell；结束时移除信号监听。
function spawnGo(args) {
  const child = spawn(goCommand, args, { cwd: repoRoot, stdio: "inherit", windowsHide: true });
  const listeners = new Map();

  const detach = () => {
    for (const [signal, listener] of listeners) process.removeListener(signal, listener);
    listeners.clear();
  };

  for (const signal of forwardedSignals) {
    const listener = () => {
      // 转发给直接子进程；go 命令自身可能再派生编译进程，脚本不保证清理全部后代。
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }

  child.on("error", (error) => {
    detach();
    console.error("执行 go 失败：" + error.message);
    process.exitCode = 1;
  });
  child.on("exit", detach);

  return child;
}

function printUsage() {
  console.error("用法：node scripts/go.mjs <run|migrate|test|build> [附加参数]");
  console.error("  run      go run ./cmd/markvault（附加参数传给程序）");
  console.error("  migrate  go run ./cmd/markvault -migrate（附加参数传给程序）");
  console.error("  test     go test ./...（附加参数是 go test 标志，放在包路径之前）");
  console.error("  build    编译 markvault 与 markvault-migrate 到 build/（附加参数是 go build 标志）");
}
