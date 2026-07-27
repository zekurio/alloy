import { createLogger } from "@alloy/logging"

import { selectEmbeddableClip } from "./clips/access"
import {
  embedPosterUrl,
  embedVideo,
  type EmbedVideo,
} from "./clips/embed-media"
import { clipAccentColor, clipEmbedDescription } from "./clips/embed-text"
import { clipIdFromPath } from "./clips/permalink"
import { env } from "./env"
import { clipGameName } from "./games/ref"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")

type MetadataClip = NonNullable<
  Awaited<ReturnType<typeof selectEmbeddableClip>>
>

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
  const gameName = clipGameName(row)
  const description = clipEmbedDescription({ ...row, gameName })
  const poster = embedPosterUrl(row, origin)
  const video = embedVideo(row, origin)
  const permalink = new URL(`/clips/${row.id}`, origin).toString()

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    metaName("description", description),
    // Supplies the bold author line above the title — the slot YouTube fills
    // with the channel name. OpenGraph has no equivalent field, so without this
    // the embed jumps straight from the site name to the title.
    linkAlternate(
      "application/json+oembed",
      new URL(
        `/api/oembed?url=${encodeURIComponent(permalink)}`,
        origin,
      ).toString(),
    ),
    metaName("theme-color", clipAccentColor(gameName)),
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
