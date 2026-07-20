import { createReadStream } from "node:fs"
import { stat, readFile } from "node:fs/promises"
import { Readable } from "node:stream"

import type { PublicAuthConfig } from "@alloy/contracts"
import type { Context, Hono } from "hono"

import { buildPublicAuthConfig } from "./auth/public-config"
import { getSession } from "./auth/session"
import { configStore } from "./config/store"
import { env } from "./env"
import { isAbsolute, join, relative, resolve } from "./runtime/path"
import { clipHead } from "./web-clip-head"
import { htmlEscape } from "./web-html"

const HEAD_MARKER = "<!-- alloy:head -->"
const BOOTSTRAP_MARKER = "<!-- alloy:bootstrap -->"
const DEFAULT_WEB_DIST_DIR = "../../build/www"
const PUBLIC_WEB_PATHS = new Set(["/login", "/setup", "/sign-up"])

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

function withInjectedHead(indexHtml: string, head: string): string {
  if (!head) return indexHtml
  return indexHtml.replace(HEAD_MARKER, `${head}\n    ${HEAD_MARKER}`)
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
  return indexHtml.replace(BOOTSTRAP_MARKER, script)
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
  const webMount = mount

  async function serveFile(
    c: Context,
    requestPath: string,
    cacheControl: string,
  ) {
    const path = safeJoin(webMount.distDir, requestPath)
    if (!path) return c.notFound()

    const s = await stat(path).catch(() => null)
    if (!s?.isFile()) return c.notFound()

    c.header("Content-Type", contentType(path))
    c.header("Content-Length", String(s.size))
    c.header("Cache-Control", cacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    const stream = Readable.toWeb(createReadStream(path))
    return c.body(stream as ReadableStream<Uint8Array>)
  }

  app.on(["GET", "HEAD"], "/assets/*", (c) =>
    serveFile(c, c.req.path, WEB_ASSET_CACHE_CONTROL),
  )

  app.on(["GET", "HEAD"], "/logo.png", (c) =>
    serveFile(c, "/logo.png", "public, max-age=86400"),
  )

  app.on(["GET", "HEAD"], "/favicon.ico", (c) =>
    serveFile(c, "/logo.png", "public, max-age=86400"),
  )

  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    serveFile(c, "/robots.txt", "public, max-age=86400"),
  )

  // Blurred sample thumbnail referenced by the admin webhook test embed;
  // must be publicly fetchable so Discord can render the test message.
  app.on(["GET", "HEAD"], "/webhook-test-thumbnail.jpg", (c) =>
    serveFile(c, "/webhook-test-thumbnail.jpg", "public, max-age=86400"),
  )

  app.on(["GET", "HEAD"], "*", async (c) => {
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
      withInjectedHead(webMount.indexHtml, head),
      bootstrapScript(await buildPublicAuthConfig(), nonce),
    )
    return c.html(html)
  })

  return app
}
