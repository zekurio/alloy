import { htmlEscape } from "@alloy/server/web-html"

import { embedPosterUrl, embedVideo, type EmbedMediaClip } from "./embed-media"
import { encodeClipStatusId } from "./status-id"

/**
 * A Mastodon API v1 `Status`, which is what Discord fetches after following the
 * `application/activity+json` alternate link in the clip head. It is the
 * Mastodon REST shape, not an ActivityPub `Note` — no `@context`, no
 * `type: "Note"` — matching what FxEmbed serves.
 *
 * Engagement counts deliberately live in `content` rather than in
 * `replies_count`/`favourites_count`: that is where Discord renders them, and
 * it is what the fxtwitter embeds this was modelled on do.
 */
export type StatusClip = EmbedMediaClip & {
  title: string
  description: string | null
  gameName: string
  createdAt: Date
  durationMs: number | null
  thumbBlurHash: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  author: {
    id: string
    username: string
    displayName: string | null
    image: string | null
    banner: string | null
    createdAt: Date
    updatedAt: Date
  }
}

export function clipStatusDocument(
  clip: StatusClip,
  options: { origin: string; siteName: string },
) {
  const statusId = encodeClipStatusId(clip.id)
  if (!statusId) return null

  const permalink = new URL(`/clips/${clip.id}`, options.origin).toString()
  const profileUrl = new URL(
    `/u/${clip.author.username}`,
    options.origin,
  ).toString()

  return {
    id: statusId,
    url: permalink,
    uri: permalink,
    created_at: clip.createdAt.toISOString(),
    edited_at: null,
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    language: null,
    content: statusContent(clip),
    spoiler_text: "",
    visibility: "public",
    application: { name: options.siteName, website: null },
    media_attachments: mediaAttachments(clip, options.origin),
    account: {
      id: clip.author.id,
      display_name: clip.author.displayName?.trim() || clip.author.username,
      username: clip.author.username,
      acct: clip.author.username,
      url: profileUrl,
      uri: profileUrl,
      created_at: clip.author.createdAt.toISOString(),
      locked: false,
      bot: false,
      discoverable: true,
      indexable: false,
      group: false,
      avatar: assetUrl(clip.author.image, options.origin),
      avatar_static: assetUrl(clip.author.image, options.origin),
      header: assetUrl(clip.author.banner, options.origin),
      header_static: assetUrl(clip.author.banner, options.origin),
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      hide_collections: false,
      noindex: false,
      emojis: [],
      roles: [],
      fields: [],
    },
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null,
  }
}

function statusContent(clip: StatusClip): string {
  const paragraphs = [`<b>${htmlEscape(clip.title)}</b>`]

  const description = clip.description?.trim()
  if (description) {
    paragraphs.push(htmlEscape(description).replaceAll("\n", "<br>"))
  }
  paragraphs.push(htmlEscape(clip.gameName))

  const stats = statsLine(clip)
  if (stats) paragraphs.push(stats)

  return paragraphs.map((body) => `<p>${body}</p>`).join("")
}

function statsLine(clip: StatusClip): string {
  // Zero counts are omitted rather than rendered as "0", so a fresh clip shows
  // a clean embed instead of a row of noise.
  return [
    clip.viewCount > 0 ? `👁️ ${formatStatCount(clip.viewCount)}` : null,
    clip.likeCount > 0 ? `❤️ ${formatStatCount(clip.likeCount)}` : null,
    clip.commentCount > 0 ? `💬 ${formatStatCount(clip.commentCount)}` : null,
  ]
    .filter(Boolean)
    .join("&ensp;")
}

/**
 * Compact, locale-free counts for the embed wire format. The web app's
 * formatCount is locale-aware via the i18n runtime, which has no meaning for a
 * document rendered inside someone else's Discord client.
 */
const STAT_UNITS = ["K", "M", "B", "T"] as const

export function formatStatCount(value: number): string {
  const count = Math.trunc(Math.abs(value))
  if (count < 1_000) return String(count)

  let divisor = 1_000
  let unitIndex = 0
  while (unitIndex < STAT_UNITS.length - 1 && count >= divisor * 1_000) {
    divisor *= 1_000
    unitIndex += 1
  }

  const scaled = Math.trunc((count / divisor) * 10) / 10
  const formatted = Number.isInteger(scaled)
    ? String(scaled)
    : scaled.toFixed(1)
  return `${formatted}${STAT_UNITS[unitIndex]}`
}

function mediaAttachments(clip: StatusClip, origin: string) {
  const video = embedVideo(clip, origin)
  const poster = embedPosterUrl(clip, origin)
  if (!video) return []

  return [
    {
      id: clip.id,
      type: "video",
      url: video.url,
      preview_url: poster,
      remote_url: null,
      preview_remote_url: null,
      text_url: null,
      description: clip.title,
      blurhash: clip.thumbBlurHash,
      meta: {
        original: {
          width: video.width,
          height: video.height,
          size:
            video.width && video.height
              ? `${video.width}x${video.height}`
              : null,
          aspect:
            video.width && video.height ? video.width / video.height : null,
          duration: clip.durationMs ? clip.durationMs / 1_000 : null,
        },
      },
    },
  ]
}

function assetUrl(path: string | null, origin: string): string | null {
  if (!path) return null
  return new URL(path, origin).toString()
}
