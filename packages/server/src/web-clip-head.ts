import { clipShareUrl } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import { selectEmbeddableClip } from "./clips/access"
import {
  embedPosterUrl,
  embedVideo,
  type EmbedVideo,
} from "./clips/embed-media"
import { clipAccentColor, clipEmbedProvider } from "./clips/embed-metadata"
import { clipIdFromPath } from "./clips/permalink"
import { env } from "./env"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")

type MetadataClip = NonNullable<
  Awaited<ReturnType<typeof selectEmbeddableClip>>
>

/**
 * Metadata for a clip permalink, injected into the app shell for crawlers.
 *
 * OpenGraph supplies the title and media; oEmbed supplies the uploader's profile
 * link. Both bare and game-scoped permalinks share the same metadata, with the
 * game-scoped form as the canonical link when the clip has a game. Only the
 * request path selects the clip.
 */
export async function clipHead(pathname: string): Promise<string> {
  const clipId = clipIdFromPath(pathname)
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
  const permalink = clipShareUrl(row.id, row.gameRef?.slug ?? null, origin)
  const provider = clipEmbedProvider(row.authorUsername, origin)
  const poster = embedPosterUrl(row, origin)
  const video = row.mediaKind === "video" ? embedVideo(row, origin) : null
  const oembedUrl = new URL("/api/oembed", origin)
  oembedUrl.searchParams.set("url", permalink)

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    `<link rel="alternate" type="application/json+oembed" href="${htmlEscape(oembedUrl.toString())}" />`,
    metaName("theme-color", clipAccentColor(row.gameRef?.name ?? row.game)),
    metaProperty("og:site_name", provider.name),
    metaProperty("og:type", video ? "video.other" : "website"),
    metaProperty("og:url", permalink),
    metaProperty("og:title", row.title),
    ...(poster ? [metaProperty("og:image", poster)] : []),
    ...socialVideoTags(video),
    metaName("twitter:card", poster ? "summary_large_image" : "summary"),
    metaName("twitter:title", row.title),
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

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${htmlEscape(content)}" />`
}
