import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import viteCompression from 'vite-plugin-compression'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 构建时只注入 package.json 的 version，避免把整个 package 打进浏览器包
const appVersion = (() => {
  const packagePath = path.resolve(__dirname, 'package.json')
  let pkg: { version?: unknown }
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
  } catch (error) {
    // 版本号必须来自真实构建，读取失败直接中止构建，不展示虚假版本
    throw new Error(
      `无法读取 ${packagePath} 以注入应用版本：${error instanceof Error ? error.message : 'unknown error'}`
    )
  }

  if (typeof pkg.version !== 'string' || pkg.version.trim() === '') {
    throw new Error(`${packagePath} 缺少有效的 version 字段，无法注入应用版本`)
  }
  return pkg.version.trim()
})()

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    // 让设置页直接显示实际构建版本，不在代码里手写版本号
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      react(),
      // 生产环境启用压缩
      isProduction && viteCompression({
        verbose: true,
        disable: false,
        threshold: 10240,
        algorithm: 'gzip',
        ext: '.gz',
      }),
      isProduction && viteCompression({
        verbose: true,
        disable: false,
        threshold: 10240,
        algorithm: 'brotliCompress',
        ext: '.br',
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    build: {
      // 生产环境优化
      minify: 'terser',
      terserOptions: {
        compress: {
          // 删除 console
          drop_console: true,
          // 删除 debugger
          drop_debugger: true,
          // 移除未使用的代码
          pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
        },
        format: {
          // 删除注释
          comments: false,
        },
        mangle: {
          // 混淆变量名
          toplevel: true,
        },
      },
      // 分块策略
      rollupOptions: {
        output: {
          // 手动分块
          manualChunks: {
            // React 与查询组件共享依赖，放在同一分块避免升级后产生循环引用。
            'react-vendor': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', '@tanstack/react-virtual'],
            'utils': ['date-fns', 'zustand'],
          },
          // 文件名混淆
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      // 增加分块大小警告阈值
      chunkSizeWarningLimit: 1000,
      // 发布产物不生成源码映射。
      sourcemap: false,
    },
  }
})
