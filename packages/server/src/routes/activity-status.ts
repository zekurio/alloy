import { decodeDiscordActivityId } from "@alloy/server/discord-activity-id"
import { env } from "@alloy/server/env"
import { notFound } from "@alloy/server/runtime/http-response"
import {
  clipDetailLine,
  clipSocialPoster,
  clipSocialVideo,
  visiblePublicClip,
  type MetadataClip,
} from "@alloy/server/web-clip-head"
import { Hono } from "hono"

import { htmlEscape } from "../web-html"

/**
 * Mastodon-compatible status endpoint used by Discord's ActivityPub unfurler.
 * FxEmbed advertises a fake Mastodon status URL, then serves this API shape so
 * Discord exposes author avatars, account names, media, and branded footers.
 */
export const activityStatusRoute = new Hono().get("/:id", async (c) => {
  const clipId = decodeDiscordActivityId(c.req.param("id"))
  if (!clipId) return notFound(c)

  const row = await visiblePublicClip(clipId)
  if (!row) return notFound(c)

  const origin = env.PUBLIC_SERVER_URL.replace(/\/+$/, "")
  const clipUrl = `${origin}/clips/${row.id}`
  const profileUrl = `${origin}/u/${encodeURIComponent(row.authorUsername)}`
  const avatar = new URL(row.authorImage ?? "/logo.png", origin).toString()

  c.header("Cache-Control", "public, max-age=300")
  return c.json({
    id: row.id,
    url: clipUrl,
    uri: clipUrl,
    created_at: row.createdAt.toISOString(),
    edited_at: null,
    reblog: null,
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    language: null,
    content: activityContent(row),
    spoiler_text: "",
    visibility: "public",
    application: {
      name: "alloy",
      website: origin,
    },
    media_attachments: activityMedia(row, origin),
    account: {
      id: row.authorId,
      display_name: row.authorUsername,
      // Discord normally renders Mastodon accounts as "name (@acct)". Alloy
      // has one username, so empty account handles leave one author name only.
      username: "",
      acct: "",
      url: profileUrl,
      uri: profileUrl,
      created_at: row.createdAt.toISOString(),
      locked: false,
      bot: false,
      discoverable: true,
      indexable: false,
      group: false,
      avatar,
      avatar_static: avatar,
      header: avatar,
      header_static: avatar,
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
  })
})

function activityContent(row: MetadataClip): string {
  const detailLine = clipDetailLine(row)
  return [
    activityText(row.title),
    row.description?.trim() ? activityText(row.description.trim()) : null,
    detailLine ? `<b>${htmlEscape(detailLine)}</b>` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("<br><br>")
}

function activityText(value: string): string {
  return htmlEscape(value).replace(/\r?\n/g, "<br>")
}

function activityMedia(row: MetadataClip, origin: string) {
  const video = clipSocialVideo(row, origin)
  const poster = clipSocialPoster(row, origin)
  if (video.url) {
    return [
      {
        id: row.id,
        type: "video",
        url: video.url,
        preview_url: poster,
        remote_url: null,
        preview_remote_url: null,
        text_url: null,
        description: row.description,
        meta: activityMediaMeta(video.width, video.height),
      },
    ]
  }
  if (!poster) return []
  return [
    {
      id: row.id,
      type: "image",
      url: poster,
      preview_url: null,
      remote_url: null,
      preview_remote_url: null,
      text_url: null,
      description: row.description,
      meta: activityMediaMeta(row.width, row.height),
    },
  ]
}

function activityMediaMeta(width: number | null, height: number | null) {
  if (!width || !height) return {}
  return {
    original: {
      width,
      height,
      size: `${width}x${height}`,
      aspect: width / height,
    },
  }
}
