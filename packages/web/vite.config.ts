import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { promisify } from "node:util"
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib"

import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite"

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

const PRECOMPRESSED_EXTENSIONS = /\.(?:css|js|json|svg|txt|webmanifest)$/
// Below this, the encoded file saves less than a packet.
const PRECOMPRESS_MIN_BYTES = 1024
const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/**
 * Writes `.br` and `.gz` beside every compressible build file. The server
 * picks one per request from Accept-Encoding, so browsers download the
 * smallest form without any compression work at request time. index.html is
 * skipped: the server fills in a nonce and boot data on every request.
 */
function precompressAssets(): Plugin {
  let outDir = ""
  return {
    name: "alloy:precompress-assets",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir
    },
    async closeBundle() {
      const files = await readdir(outDir, { recursive: true })
      await Promise.all(
        files
          .filter((file) => PRECOMPRESSED_EXTENSIONS.test(file))
          .map(async (file) => {
            const path = join(outDir, file)
            const source = await readFile(path)
            if (source.byteLength < PRECOMPRESS_MIN_BYTES) return
            const [br, gz] = await Promise.all([
              brotli(source, {
                params: {
                  [zlibConstants.BROTLI_PARAM_QUALITY]:
                    zlibConstants.BROTLI_MAX_QUALITY,
                  [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
                },
              }),
              gzipAsync(source, { level: zlibConstants.Z_BEST_COMPRESSION }),
            ])
            await Promise.all([
              br.byteLength < source.byteLength
                ? writeFile(`${path}.br`, br)
                : undefined,
              gz.byteLength < source.byteLength
                ? writeFile(`${path}.gz`, gz)
                : undefined,
            ])
          }),
      )
    },
  }
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
    precompressAssets(),
  ],
}))

export default config
