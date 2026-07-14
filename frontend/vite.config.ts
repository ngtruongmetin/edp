import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "")
  const backendOrigin = env.BACKEND_ORIGIN || "http://127.0.0.1:3000"
  const frontendPort = Number(env.FRONTEND_PORT) || 5173

  return {
    plugins: [
      react(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "autoUpdate",
        manifest: {
          name: "EduDiscipline Platform",
          short_name: "EDP",
          description:
            "Hệ thống quản lý thi đua cờ đỏ tại Trường THPT Nguyễn Trãi - Bình Dương.",
          id: "/",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#2e77df",
          lang: "vi",
          categories: ["education", "productivity"],
          icons: [
            {
              src: "/pwa/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa/maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        injectManifest: {
          globPatterns: [
            "**/*.{html,js,css,png,svg,ico,woff,woff2,ttf,eot,webmanifest}",
          ],
        },
      }),
    ],
    build: {
      sourcemap: false,
      assetsDir: "fe-assets",
    },
    server: {
      host: "0.0.0.0",
      port: frontendPort,
      proxy: {
        "/api": {
          target: backendOrigin,
          changeOrigin: true,
          secure: false,
        },
        "/assets": {
          target: backendOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
      allowedHosts: [
        "edp.bcic.site"
      ]
    }
  }
})
