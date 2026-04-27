import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Readable } from "node:stream"

import type { Context, Hono } from "hono"

import { eq } from "drizzle-orm"
import { user } from "@workspace/db/auth-schema"
import type { ClipEncodedVariant } from "@workspace/db/schema"

import { db } from "./db"
import { env } from "./env"
import { configStore, type EncoderOpenGraphTarget } from "./lib/config-store"
import { selectClipById } from "./lib/clip-select"

const HEAD_MARKER = "<!-- alloy:head -->"
const CLIP_PERMALINK_RE = /^\/g\/[^/]+\/c\/([^/]+)\/?$/
const DEFAULT_WEB_DIST_DIR = "../../build/www"

type MetadataClip = NonNullable<Awaited<ReturnType<typeof selectClipById>>>

type WebMount = {
  distDir: string
  indexHtml: string
}

function nodeToWeb(node: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(node) as ReadableStream<Uint8Array>
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
    env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR
  )
  const indexPath = join(distDir, "index.html")
  const indexExists = await fileExists(indexPath)

  if (!indexExists) return null

  return {
    distDir,
    indexHtml: await readFile(indexPath, "utf8"),
  }
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${htmlEscape(content)}" />`
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${htmlEscape(content)}" />`
}

function selectOpenGraphVideo(
  row: MetadataClip,
  target: EncoderOpenGraphTarget
): ClipEncodedVariant | null {
  const variants = row.variants.filter(
    (variant) => variant.contentType === "video/mp4"
  )
  const playbackVariants = variants.filter(
    (variant) => variant.role !== "source" && variant.id !== "source"
  )
  const defaultPlaybackVariant =
    playbackVariants.find((variant) => variant.isDefault) ??
    playbackVariants[0] ??
    null
  switch (target.type) {
    case "none":
      return null
    case "source":
      return (
        variants.find(
          (variant) => variant.role === "source" || variant.id === "source"
        ) ?? null
      )
    case "defaultVariant":
      return defaultPlaybackVariant
    case "variant":
      return (
        variants.find(
          (variant) =>
            variant.role !== "source" && variant.id === target.variantId
        ) ?? null
      )
  }
}

async function visiblePublicClip(id: string): Promise<MetadataClip | null> {
  const row = await selectClipById(id)
  if (!row) return null
  if (row.status !== "ready") return null
  if (row.privacy !== "public" && row.privacy !== "unlisted") return null

  const [author] = await db
    .select({ disabledAt: user.disabledAt })
    .from(user)
    .where(eq(user.id, row.authorId))
    .limit(1)
  if (author?.disabledAt) return null

  return row
}

async function clipHead(pathname: string): Promise<string> {
  const match = CLIP_PERMALINK_RE.exec(pathname)
  const clipId = match?.[1]
  if (!clipId) return ""

  try {
    const row = await visiblePublicClip(clipId)
    if (!row) return ""

    const origin = env.PUBLIC_SERVER_URL
    const description =
      row.description?.trim() ||
      `${row.authorUsername} shared a ${
        row.gameRef?.name ?? row.game ?? "game"
      } clip on alloy.`
    const poster = row.thumbKey
      ? new URL(`/api/clips/${row.id}/thumbnail`, origin).toString()
      : null
    const ogVariant = selectOpenGraphVideo(
      row,
      configStore.get("encoder").openGraphTarget
    )
    const videoUrl = ogVariant
      ? new URL(
          `/api/clips/${row.id}/stream?variant=${encodeURIComponent(
            ogVariant.id
          )}`,
          origin
        ).toString()
      : null
    const width = ogVariant?.width ?? row.width
    const height = ogVariant?.height ?? row.height

    return [
      `<title>${htmlEscape(row.title)} | alloy</title>`,
      metaName("description", description),
      metaProperty("og:site_name", "alloy"),
      metaProperty("og:type", "video.other"),
      metaProperty("og:title", row.title),
      metaProperty("og:description", description),
      ...(poster ? [metaProperty("og:image", poster)] : []),
      ...(videoUrl
        ? [
            metaProperty("og:video", videoUrl),
            metaProperty("og:video:url", videoUrl),
            ...(videoUrl.startsWith("https:")
              ? [metaProperty("og:video:secure_url", videoUrl)]
              : []),
            metaProperty(
              "og:video:type",
              ogVariant?.contentType ?? "video/mp4"
            ),
            ...(width ? [metaProperty("og:video:width", String(width))] : []),
            ...(height
              ? [metaProperty("og:video:height", String(height))]
              : []),
          ]
        : []),
      metaName("twitter:card", "summary_large_image"),
      metaName("twitter:title", row.title),
      metaName("twitter:description", description),
      ...(poster ? [metaName("twitter:image", poster)] : []),
    ].join("\n    ")
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[web] failed to build clip metadata:", error)
    return ""
  }
}

function withInjectedHead(indexHtml: string, head: string): string {
  if (!head) return indexHtml
  return indexHtml.replace(HEAD_MARKER, `${head}\n    ${HEAD_MARKER}`)
}

export async function mountWeb(app: Hono): Promise<Hono> {
  const mount = await resolveWebMount()
  if (!mount) return app
  const webMount = mount

  async function serveFile(
    c: Context,
    requestPath: string,
    cacheControl: string
  ) {
    const path = safeJoin(webMount.distDir, requestPath)
    if (!path) return c.notFound()

    const s = await stat(path).catch(() => null)
    if (!s?.isFile()) return c.notFound()

    c.header("Content-Type", contentType(path))
    c.header("Content-Length", String(s.size))
    c.header("Cache-Control", cacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    return c.body(nodeToWeb(createReadStream(path)))
  }

  app.on(["GET", "HEAD"], "/assets/*", (c) => {
    const rel = c.req.path.slice("/assets/".length)
    return serveFile(c, `/assets/${rel}`, "public, max-age=31536000, immutable")
  })

  app.on(["GET", "HEAD"], "/alloy-logo.png", (c) =>
    serveFile(c, "/alloy-logo.png", "public, max-age=86400")
  )

  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    serveFile(c, "/robots.txt", "public, max-age=86400")
  )

  app.on(["GET", "HEAD"], "*", async (c) => {
    const pathname = new URL(c.req.url).pathname
    if (pathname === "/health" || pathname.startsWith("/api/")) {
      return c.notFound()
    }

    const head = await clipHead(pathname)
    const html = withInjectedHead(webMount.indexHtml, head)
    c.header("Content-Type", "text/html; charset=utf-8")
    c.header("Cache-Control", "no-cache")
    if (c.req.method === "HEAD") return c.body(null)
    return c.html(html)
  })

  return app
}
