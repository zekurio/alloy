import { defineConfig, loadEnv } from "vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"

const DEFAULT_SERVER_URL = "http://localhost:3000"
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url))

function normalizeServerUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function serverUrl(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "")
  return normalizeServerUrl(env.VITE_SERVER_URL?.trim() || DEFAULT_SERVER_URL)
}

const config = defineConfig(({ mode }) => ({
  cacheDir: "../../node_modules/.vite/web",
  publicDir: "../../public",
  resolve: {
    alias: [
      {
        find: /^@workspace\/api$/,
        replacement: fileURLToPath(
          new URL("../../packages/api/src/index.ts", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/api\/(.*)$/,
        replacement: fileURLToPath(
          new URL("../../packages/api/src/$1", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/contracts$/,
        replacement: fileURLToPath(
          new URL("../../packages/contracts/src/index.ts", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/contracts\/(.*)$/,
        replacement: fileURLToPath(
          new URL("../../packages/contracts/src/$1", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/db$/,
        replacement: fileURLToPath(
          new URL("../../packages/db/src/index.ts", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/db\/(.*)$/,
        replacement: fileURLToPath(
          new URL("../../packages/db/src/$1", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/ui\/globals\.css$/,
        replacement: fileURLToPath(
          new URL("../../packages/ui/src/styles/globals.css", import.meta.url)
        ),
      },
      {
        find: /^@workspace\/ui\/(.*)$/,
        replacement: fileURLToPath(
          new URL("../../packages/ui/src/$1", import.meta.url)
        ),
      },
    ],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      "/api": {
        target: serverUrl(mode),
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", serverUrl(mode))
          })
        },
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackRouter(),
    viteReact(),
  ],
}))

export default config
