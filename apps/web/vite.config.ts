import { defineConfig, loadEnv } from "vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"

const DEFAULT_SERVER_URL = "http://localhost:3000"

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
  publicDir: "../../public",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: serverUrl(mode),
        changeOrigin: true,
      },
    },
  },
  preview: {
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
