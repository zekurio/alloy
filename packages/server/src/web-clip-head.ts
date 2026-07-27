import { createLogger } from "@alloy/logging"

import { selectEmbeddableClip } from "./clips/access"
import {
  embedPosterUrl,
  embedVideo,
  type EmbedVideo,
} from "./clips/embed-media"
import { mastodonStatusHref } from "./clips/status-id"
import { env } from "./env"
import { clipGameName } from "./games/ref"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")
const CLIP_PERMALINK_RE = /^(?:\/games\/[^/]+)?\/clips\/([^/]+)\/?$/
/** `--brand-blue` from the UI theme; colours the embed's accent bar. */
const BRAND_COLOR = "#0091ff"

type MetadataClip = NonNullable<
  Awaited<ReturnType<typeof selectEmbeddableClip>>
>

export async function clipHead(pathname: string): Promise<string> {
  const clipId = CLIP_PERMALINK_RE.exec(pathname)?.[1]
  if (!clipId) return ""

  try {
    const row = await selectEmbeddableClip(clipId)
    return row ? buildClipHead(row) : ""
  } catch (error) {
    logger.error("failed to build clip metadata:", error)
    return ""
  }
}

function buildClipHead(row: MetadataClip): string {
  const origin = env.PUBLIC_SERVER_URL
  const description =
    row.description?.trim() ||
    `${row.authorUsername} shared a ${clipGameName(row)} clip on alloy.`
  const poster = embedPosterUrl(row, origin)
  const video = embedVideo(row, origin)
  const permalink = new URL(`/clips/${row.id}`, origin).toString()
  const statusHref = mastodonStatusHref(row.authorUsername, row.id, origin)

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    metaName("description", description),
    // Discord prefers the Mastodon status document over these OpenGraph tags
    // and renders it with avatar, author line and an inline player. Everything
    // below stays as the fallback for crawlers that ignore the link.
    //
    // This href is a *pattern*, not a fetchable URL: Discord matches it against
    // Mastodon's canonical ActivityPub object shape `/users/{user}/statuses/
    // {id}` to recognise a fediverse post, then derives `/api/v1/statuses/{id}`
    // and fetches that instead. FxEmbed advertises the same shape and serves a
    // 302 there, proving the advertised path is never requested. Pointing this
    // directly at /api/v1/... means Discord never matches, and silently falls
    // back to the OpenGraph tags below.
    ...(statusHref
      ? [linkAlternate("application/activity+json", statusHref)]
      : []),
    metaName("theme-color", BRAND_COLOR),
    metaProperty("og:site_name", "alloy"),
    metaProperty("og:type", "video.other"),
    metaProperty("og:url", permalink),
    metaProperty("og:title", row.title),
    metaProperty("og:description", description),
    ...(poster ? [metaProperty("og:image", poster)] : []),
    ...socialVideoTags(video),
    metaName("twitter:card", "summary_large_image"),
    metaName("twitter:title", row.title),
    metaName("twitter:description", description),
    ...(poster ? [metaName("twitter:image", poster)] : []),
  ].join("\n    ")
}

function socialVideoTags(video: EmbedVideo | null): string[] {
  if (!video) return []
  return [
    metaProperty("og:video", video.url),
    metaProperty("og:video:url", video.url),
    ...(video.url.startsWith("https:")
      ? [metaProperty("og:video:secure_url", video.url)]
      : []),
    metaProperty("og:video:type", video.type),
    ...(video.width
      ? [metaProperty("og:video:width", String(video.width))]
      : []),
    ...(video.height
      ? [metaProperty("og:video:height", String(video.height))]
      : []),
  ]
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${htmlEscape(content)}" />`
}

function linkAlternate(type: string, href: string): string {
  return `<link rel="alternate" type="${type}" href="${htmlEscape(href)}" />`
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${htmlEscape(content)}" />`
}
