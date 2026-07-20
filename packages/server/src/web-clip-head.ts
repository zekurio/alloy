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
import { encodeDiscordActivityId } from "./discord-activity-id"
import { env } from "./env"
import { clipGameRefFromSnapshot } from "./games/ref"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")
const EMBED_THEME_COLOR = "#5d4f96"
const CLIP_PERMALINK_RE = /^(?:\/games\/[^/]+)?\/clips\/([^/]+)\/?$/

export type MetadataClip = NonNullable<
  Awaited<ReturnType<typeof selectClipById>>
>

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

/**
 * Clip row for public metadata surfaces (social head tags, oEmbed): ready,
 * public or unlisted, and not authored by a disabled account.
 */
export async function visiblePublicClip(
  id: string,
): Promise<MetadataClip | null> {
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
  // FxTwitter-style social card: the author is the bold top line (og:title),
  // and the body carries the clip title plus the author's own description.
  // No engagement counts — unfurlers snapshot tags at post time, so counts
  // would be permanently frozen (and near-zero for publish announcements).
  const socialDescription = clipSocialDescription(row)
  const seoDescription =
    row.description?.trim() ||
    `${row.authorUsername} shared a ${clipGameName(row)} clip on alloy.`
  const poster = clipSocialPoster(row, origin)
  const video = clipSocialVideo(row, origin)
  const clipUrl = new URL(`/clips/${row.id}`, origin).toString()
  // FxTwitter-style author avatar: link unfurlers (Discord) render the page's
  // apple-touch-icon as the round icon next to the embed title, so replace the
  // app shell's generic icon with the author's avatar per clip page.
  const authorAvatar = new URL(
    row.authorImage ?? "/logo.png",
    origin,
  ).toString()
  // Discord combines the rich oEmbed fields with these OpenGraph fields in a
  // non-standard way. FxEmbed's proven layout puts body/details in oEmbed,
  // while og:site_name plus the favicon remain available for the footer.
  // Version the discovery URL so Discord cannot reuse the previous field
  // layout from its independent oEmbed cache after an Alloy upgrade.
  const oembedUrl = new URL(`/api/oembed?clip=${row.id}&v=2`, origin).toString()
  const favicon = new URL("/logo.png", origin).toString()
  // FxEmbed's current Discord layout is a Mastodon compatibility path. The
  // numeric snowcode convinces Discord to resolve /api/v1/statuses/:id and use
  // its explicit account, media, content, and timestamp fields.
  const activityUrl = new URL(
    `/users/${encodeURIComponent(row.authorUsername)}/statuses/${encodeDiscordActivityId(row.id)}`,
    origin,
  ).toString()

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    `<link rel="canonical" href="${htmlEscape(clipUrl)}" />`,
    metaProperty("og:url", clipUrl),
    metaProperty("theme-color", EMBED_THEME_COLOR),
    metaProperty("twitter:title", row.authorUsername),
    metaName("description", seoDescription),
    ...socialTwitterVideoTags(video),
    ...socialVideoTags(video),
    ...(poster ? [metaProperty("og:image", poster)] : []),
    ...(video.url
      ? [metaProperty("twitter:image", "0")]
      : poster
        ? [metaProperty("twitter:image", poster)]
        : []),
    `<link rel="apple-touch-icon" href="${htmlEscape(authorAvatar)}" />`,
    metaProperty("twitter:card", video.url ? "player" : "summary_large_image"),
    metaProperty("og:title", row.authorUsername),
    metaProperty("og:description", socialDescription),
    metaProperty("og:site_name", "alloy"),
    `<link rel="icon" type="image/png" sizes="256x256" href="${htmlEscape(favicon)}" />`,
    `<link rel="alternate" type="application/json+oembed" href="${htmlEscape(oembedUrl)}" title="${htmlEscape(row.authorUsername)}" />`,
    `<link rel="alternate" type="application/activity+json" href="${htmlEscape(activityUrl)}" />`,
  ].join("\n    ")
}

export function clipSocialDescription(row: MetadataClip): string {
  return [row.title, row.description?.trim() || null]
    .filter((part): part is string => part !== null)
    .join("\n\n")
}

export function clipGameName(row: MetadataClip): string {
  if (row.gameId === null) return row.game?.trim() || "Uncategorised"
  return clipGameRefFromSnapshot({ id: row.gameId, name: row.game }).name
}

/** "Game · duration" line; either part may be missing. */
export function clipDetailLine(row: MetadataClip): string {
  const hasGame = row.gameId !== null || Boolean(row.game?.trim())
  return [
    hasGame ? clipGameName(row) : null,
    row.durationMs !== null && row.durationMs > 0
      ? formatDuration(row.durationMs)
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ")
}

export function clipSocialPoster(
  row: MetadataClip,
  origin: string,
): string | null {
  if (!row.thumbKey) return null
  return new URL(
    `/api/clips/${row.id}/thumbnail?v=${clipAssetVersion(row.thumbKey)}`,
    origin,
  ).toString()
}

export function clipSocialVideo(row: MetadataClip, origin: string) {
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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function socialVideoTags(video: ReturnType<typeof clipSocialVideo>): string[] {
  if (!video.url) return []
  return [
    metaProperty("og:video", video.url),
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

function socialTwitterVideoTags(
  video: ReturnType<typeof clipSocialVideo>,
): string[] {
  if (!video.url) return []
  return [
    ...(video.height
      ? [metaProperty("twitter:player:height", String(video.height))]
      : []),
    ...(video.width
      ? [metaProperty("twitter:player:width", String(video.width))]
      : []),
    metaProperty("twitter:player:stream", video.url),
    metaProperty("twitter:player:stream:content_type", video.type),
  ]
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${htmlEscape(content)}" />`
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${htmlEscape(content)}" />`
}
