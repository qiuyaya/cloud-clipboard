import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "fs";

// Read version from package.json
const packageJsonPath = path.resolve(__dirname, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon-*.svg", "icon.svg"],
      manifest: {
        name: "Cloud Clipboard",
        short_name: "CloudClip",
        description: "Share clipboard content seamlessly across devices",
        theme_color: "#6366f1",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: process.env.VITE_BASE_PATH || "/",
        start_url: process.env.VITE_BASE_PATH || "/",
        icons: [
          {
            src: "favicon-192x192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "favicon-512x512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,txt,woff2}"],
        globIgnores: ["**/node_modules/**/*", "sw.js", "workbox-*.js", "dev-dist/**/*"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // 只读 API 请求使用 NetworkFirst，离线时有 fallback
          {
            urlPattern: /\/api\/(health|rooms\/info)/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-readonly-cache",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60, // 1 minute
              },
            },
          },
          // 其他 API 请求使用 NetworkOnly，确保每次都获取最新数据
          {
            urlPattern: /\/api\//i,
            handler: "NetworkOnly",
            options: {
              cacheName: "api-cache",
            },
          },
          // 分享文件下载使用 NetworkOnly，完全不缓存
          {
            urlPattern: /\/public\/file\//i,
            handler: "NetworkOnly",
            options: {
              cacheName: "file-download-cache",
            },
          },
        ],
        navigateFallbackDenylist: [/^\/public\//, /^\/api\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
