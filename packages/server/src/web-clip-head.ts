import { user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import {
  renditionIsH264,
  sourceIsBroadlyDecodable,
} from "@alloy/server/clips/codecs"
import { eq } from "drizzle-orm"

import { clipAssetVersion } from "./clips/asset-version"
import { selectClipById } from "./clips/select"
import { db } from "./db"
import { env } from "./env"
import { clipGameRefFromSnapshot } from "./games/ref"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")
const CLIP_PERMALINK_RE = /^(?:\/games\/[^/]+)?\/clips\/([^/]+)\/?$/

type MetadataClip = NonNullable<Awaited<ReturnType<typeof selectClipById>>>

export async function clipHead(pathname: string): Promise<string> {
  const clipId = CLIP_PERMALINK_RE.exec(pathname)?.[1]
  if (!clipId) return ""

  try {
    const row = await visiblePublicClip(clipId)
    return row ? buildClipHead(row) : ""
  } catch (error) {
    logger.error("failed to build clip metadata:", error)
    return ""
  }
}

async function visiblePublicClip(id: string): Promise<MetadataClip | null> {
  const row = await selectClipById(id)
  if (!row) return null
  if (row.status !== "ready") return null
  if (row.privacy !== "public" && row.privacy !== "unlisted") return null

  const [author] = await db
    .select({ disabledAt: user.disabled_at })
    .from(user)
    .where(eq(user.id, row.authorId))
    .limit(1)
  if (author?.disabledAt) return null

  return row
}

function buildClipHead(row: MetadataClip): string {
  const origin = env.PUBLIC_SERVER_URL
  const description =
    row.description?.trim() ||
    `${row.authorUsername} shared a ${clipGameName(row)} clip on alloy.`
  const poster = row.thumbKey
    ? new URL(
        `/api/clips/${row.id}/thumbnail?v=${clipAssetVersion(row.thumbKey)}`,
        origin,
      ).toString()
    : null
  const video = socialVideo(row, origin)

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    metaName("description", description),
    metaProperty("og:site_name", "alloy"),
    metaProperty("og:type", "video.other"),
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

function clipGameName(row: MetadataClip): string {
  if (row.gameId === null) return row.game?.trim() || "Uncategorised"
  return clipGameRefFromSnapshot({ id: row.gameId, name: row.game }).name
}

function socialVideo(row: MetadataClip, origin: string) {
  // Social video embeds are only reliable for H.264/AAC. Source codec metadata
  // is required; legacy null sourceCodecs must use the rendition fallbacks.
  const renditionRows = row.renditionRows ?? []
  const rendition =
    renditionRows.find(
      (candidate) => candidate.og && renditionIsH264(candidate.codecs),
    ) ??
    renditionRows.find((candidate) => renditionIsH264(candidate.codecs)) ??
    null
  const embeddableSource =
    row.sourceContentType === "video/mp4" ||
    row.sourceContentType === "video/webm"
  const playbackSourceKey = row.cutKey ?? row.sourceKey
  const source =
    playbackSourceKey &&
    sourceIsBroadlyDecodable(row.sourceCodecs) &&
    (row.cutKey !== null || embeddableSource)
      ? {
          key: playbackSourceKey,
          contentType: row.cutKey ? "video/mp4" : row.sourceContentType,
        }
      : null
  const url = source
    ? new URL(
        `/api/clips/${row.id}/source/file?v=${clipAssetVersion(source.key)}`,
        origin,
      ).toString()
    : rendition
      ? new URL(
          `/api/clips/${row.id}/rendition/${rendition.name}/file.mp4?v=${clipAssetVersion(rendition.key)}`,
          origin,
        ).toString()
      : renditionRows.length === 0 && row.sourceKey && embeddableSource
        ? new URL(`/api/clips/${row.id}/stream`, origin).toString()
        : null

  return {
    url,
    type: source
      ? (source.contentType ?? "video/mp4")
      : rendition
        ? "video/mp4"
        : (row.sourceContentType ?? "video/mp4"),
    width: source ? row.width : (rendition?.width ?? row.width),
    height: source ? row.height : (rendition?.height ?? row.height),
  }
}

function socialVideoTags(video: ReturnType<typeof socialVideo>): string[] {
  if (!video.url) return []
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
