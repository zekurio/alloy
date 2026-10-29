import { stat, readFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"

import type { PublicAuthConfig } from "@alloy/contracts"
import type { Context, Hono } from "hono"

import { buildPublicAuthConfig } from "./auth/public-config"
import { getSession } from "./auth/session"
import { configStore } from "./config/store"
import { env } from "./env"
import { fsCreateReadStream } from "./storage/fs-driver-helpers"
import { clipHead } from "./web-clip-head"
import { htmlEscape, withInjectedHead } from "./web-html"

const BOOTSTRAP_MARKER = "<!-- alloy:bootstrap -->"
const CSP_NONCE_MARKER = "__ALLOY_CSP_NONCE__"
const DEFAULT_WEB_DIST_DIR = "../../build/www"
const PUBLIC_WEB_PATHS = new Set([
  "/login",
  "/setup",
  "/sign-up",
  "/desktop/authorize",
])

type WebMount = {
  distDir: string
  indexHtml: string
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8"
  }
  if (path.endsWith(".json")) return "application/json; charset=utf-8"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".webp")) return "image/webp"
  if (path.endsWith(".ico")) return "image/x-icon"
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8"
  if (path.endsWith(".woff2")) return "font/woff2"
  if (path.endsWith(".woff")) return "font/woff"
  return "application/octet-stream"
}

// Everything under /assets/ carries a content hash in its filename, so it can
// be cached forever. Deploys ship new hashes via index.html, which stays
// no-cache.
const WEB_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

// Static files outside /assets/ have no content hash, so they get a day.
const STATIC_CACHE_CONTROL = "public, max-age=86400"
const STATIC_FILES: ReadonlyArray<[route: string, file: string]> = [
  ["/logo.png", "/logo.png"],
  ["/logo.svg", "/logo.svg"],
  // Square on purpose: iOS rounds touch icons itself and fills transparent
  // corners with black.
  ["/apple-touch-icon.png", "/apple-touch-icon.png"],
  ["/favicon.ico", "/logo.png"],
  ["/robots.txt", "/robots.txt"],
]

function safeJoin(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }

  const target = resolve(root, decoded.replace(/^\/+/, ""))
  const rel = relative(root, target)
  if (rel.startsWith("..") || isAbsolute(rel)) return null
  return target
}

async function resolveWebMount(): Promise<WebMount | null> {
  const distDir = resolve(
    process.cwd(),
    env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR,
  )
  const indexPath = join(distDir, "index.html")
  const indexExists = await fileExists(indexPath)

  if (!indexExists) return null

  return {
    distDir,
    indexHtml: await readFile(indexPath, "utf8"),
  }
}

/**
 * Inline the public auth config into the app shell so the client has it before
 * React boots — no blocking `/api/auth-config` round-trip on first paint. Only
 * public (non-secret) data goes here; `<` is escaped to prevent a `</script>`
 * breakout.
 */
function bootstrapScript(config: PublicAuthConfig, nonce: string): string {
  // Escape `<` (blocks </script> breakout) and U+2028/U+2029, which are legal in
  // JSON but illegal as raw line terminators in a JS string on older engines.
  const json = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
  return `<script nonce="${htmlEscape(nonce)}">globalThis.__ALLOY_PUBLIC_CONFIG__=${json}</script>`
}

function withInjectedBootstrap(indexHtml: string, script: string): string {
  // A function replacer keeps `$&`-style patterns in config text literal.
  return indexHtml.replace(BOOTSTRAP_MARKER, () => script)
}

function withInjectedNonce(indexHtml: string, nonce: string): string {
  return indexHtml.replaceAll(CSP_NONCE_MARKER, htmlEscape(nonce))
}

// The web build writes these beside each compressible file (see the
// precompress plugin in packages/web/vite.config.ts), in preference order.
const PRECOMPRESSED_VARIANTS = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
] as const
const PRECOMPRESSIBLE_PATH = /\.(?:css|js|json|svg|txt|webmanifest)$/

/** Content codings the client accepts; `q=0` refuses one. */
function acceptedEncodings(header: string | undefined): Set<string> {
  const accepted = new Set<string>()
  for (const part of (header ?? "").split(",")) {
    const [coding = "", ...params] = part.trim().toLowerCase().split(";")
    const quality = params
      .map((param) => param.trim())
      .find((param) => {
        return param.startsWith("q=")
      })
    if (quality && Number(quality.slice(2)) === 0) continue
    if (coding) accepted.add(coding)
  }
  return accepted
}

async function serveFile(
  c: Context,
  distDir: string,
  requestPath: string,
  cacheControl: string,
) {
  const path = safeJoin(distDir, requestPath)
  if (!path) return c.notFound()

  const s = await stat(path).catch(() => null)
  if (!s?.isFile()) return c.notFound()

  let bodyPath = path
  let size = s.size
  if (PRECOMPRESSIBLE_PATH.test(path)) {
    // Caches must key on Accept-Encoding even when this client gets the
    // uncompressed file, since the next one may get a variant.
    c.header("Vary", "Accept-Encoding", { append: true })
    const accepted = acceptedEncodings(c.req.header("accept-encoding"))
    for (const variant of PRECOMPRESSED_VARIANTS) {
      if (!accepted.has(variant.encoding)) continue
      const encoded = await stat(`${path}${variant.extension}`).catch(
        () => null,
      )
      if (!encoded?.isFile()) continue
      bodyPath = `${path}${variant.extension}`
      size = encoded.size
      c.header("Content-Encoding", variant.encoding)
      break
    }
  }

  c.header("Content-Type", contentType(path))
  c.header("Content-Length", String(size))
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)
  return c.body(fsCreateReadStream(bodyPath, 0, size - 1))
}

async function serveAppShell(c: Context, mount: WebMount) {
  const pathname = new URL(c.req.url).pathname
  if (pathname === "/health" || pathname.startsWith("/api/")) {
    return c.notFound()
  }
  const head = await clipHead(pathname)
  if (
    configStore.get("requireAuthToBrowse") &&
    !PUBLIC_WEB_PATHS.has(pathname) &&
    !head
  ) {
    const session = await getSession(c)
    if (!session || session.user.status !== "active") {
      return c.redirect("/login", 302)
    }
  }

  c.header("Content-Type", "text/html; charset=utf-8")
  c.header("Cache-Control", "no-cache")
  if (c.req.method === "HEAD") return c.body(null)
  const nonce = c.get("secureHeadersNonce")
  if (!nonce) {
    throw new Error("secure headers nonce missing for app shell")
  }
  const html = withInjectedBootstrap(
    withInjectedHead(withInjectedNonce(mount.indexHtml, nonce), head),
    bootstrapScript(await buildPublicAuthConfig(), nonce),
  )
  return c.html(html)
}

export async function mountWeb(app: Hono): Promise<Hono> {
  const mount = await resolveWebMount()
  if (!mount) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        `Web build not found at ${
          env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR
        }; run the web build or set WEB_DIST_DIR.`,
      )
    }
    return app
  }

  app.on(["GET", "HEAD"], "/assets/*", (c) =>
    serveFile(c, mount.distDir, c.req.path, WEB_ASSET_CACHE_CONTROL),
  )
  for (const [route, file] of STATIC_FILES) {
    app.on(["GET", "HEAD"], route, (c) =>
      serveFile(c, mount.distDir, file, STATIC_CACHE_CONTROL),
    )
  }
  app.on(["GET", "HEAD"], "*", (c) => serveAppShell(c, mount))

  return app
}
