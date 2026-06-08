import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type ProxyOptions } from "vite"

import { clientLogger } from "./src/lib/client-log"

const DEFAULT_SERVER_URL = "http://localhost:2552"
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url))
const ATOMIC_WRITE_TEMP_FILE = /[/\\][^/\\]+\.tmp\.[^/\\]+$/
const REACT_CHUNK_PACKAGES = new Set([
  "react",
  "react-dom",
  "scheduler",
  "use-sync-external-store",
])
const EDITOR_TEMP_FILES = [
  ATOMIC_WRITE_TEMP_FILE,
  /[/\\]\.[^/\\]+\.sw[a-z]$/,
  /[/\\][^/\\]+~$/,
]

function packageNameFromModuleId(id: string): string | null {
  const normalizedId = id.replaceAll("\\", "/")
  const lastNodeModulesIndex = normalizedId.lastIndexOf("/node_modules/")

  if (lastNodeModulesIndex === -1) {
    return null
  }

  const packagePath = normalizedId.slice(
    lastNodeModulesIndex + "/node_modules/".length,
  )
  const [scopeOrName, name] = packagePath.split("/")

  if (!scopeOrName) {
    return null
  }

  return scopeOrName.startsWith("@") && name
    ? `${scopeOrName}/${name}`
    : scopeOrName
}

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

function apiProxy(mode: string): ProxyOptions {
  const apiTarget = serverUrl(mode)

  return {
    target: apiTarget,
    // Preserve the browser Origin for CSRF and WebAuthn expectedOrigin checks;
    // changeOrigin only makes the upstream Host header match the API target.
    changeOrigin: true,
    configure(proxy) {
      proxy.on("error", (err, _req, res) => {
        // Vite otherwise turns backend connection failures into an opaque 502,
        // which hides the actual dev-server dependency.
        clientLogger.error(`[vite] API proxy failed for ${apiTarget}:`, err)

        if ("writeHead" in res && !res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json" })
        }

        res.end(
          JSON.stringify({
            error: "API server unavailable",
            message: `Could not reach Alloy server at ${apiTarget}.`,
          }),
        )
      })
    },
  }
}

const config = defineConfig(({ mode }) => ({
  cacheDir: "../../node_modules/.vite/web",
  clearScreen: false,
  publicDir: "../../public",
  resolve: {
    // Keep workspace path aliases in tsconfig; Vite resolves them natively
    // during dev and build.
    tsconfigPaths: true,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Hono owns API CORS; Vite serves the app and proxies same-origin /api.
    cors: false,
    fs: {
      allow: [workspaceRoot],
    },
    watch: {
      ignored: EDITOR_TEMP_FILES,
    },
    proxy: {
      "/api": apiProxy(mode),
    },
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        // Keep lazy route chunks from importing Lucide factories through the app
        // entry; recursive manual chunks can also make Lucide absorb React.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "react",
              test: (id) => {
                const packageName = packageNameFromModuleId(id)
                return (
                  packageName !== null && REACT_CHUNK_PACKAGES.has(packageName)
                )
              },
              priority: 20,
            },
            {
              name: "lucide",
              test: (id) => packageNameFromModuleId(id) === "lucide-react",
              priority: 10,
            },
          ],
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact(),
  ],
}))

export default config
