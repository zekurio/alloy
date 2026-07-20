import {
  renderWebhookTemplate,
  type GenericWebhookConfig,
  type WebhookTemplateValues,
} from "@alloy/contracts"
import { env } from "@alloy/server/env"

import type { DiscordWebhookFile } from "./discord"
import {
  WEBHOOK_LOGO_PNG,
  WEBHOOK_TEST_AVATAR_PNG,
  WEBHOOK_TEST_THUMBNAIL_JPEG,
} from "./embed-assets"

const REQUEST_TIMEOUT_MS = 10_000

// Alloy accent (dark theme) as a Discord embed color integer.
const EMBED_COLOR = 0x5d4f96

// The brand/test images are uploaded with the webhook execute and referenced
// via attachment:// — Discord never fetches a URL for them, so they render
// from loopback and non-public instances exactly like from production.
const LOGO_ATTACHMENT_NAME = "alloy-logo.png"
const TEST_THUMBNAIL_ATTACHMENT_NAME = "test-thumbnail.jpg"
const TEST_AVATAR_ATTACHMENT_NAME = "test-avatar.png"

const LOGO_FILE: DiscordWebhookFile = {
  name: LOGO_ATTACHMENT_NAME,
  data: WEBHOOK_LOGO_PNG,
  contentType: "image/png",
}

/** Files to upload alongside a real clip announcement (footer logo). */
export function discordAnnounceFiles(): DiscordWebhookFile[] {
  return [LOGO_FILE]
}

/** Files to upload alongside the admin test message (logo, thumbnail, avatar). */
export function discordTestFiles(): DiscordWebhookFile[] {
  return [
    LOGO_FILE,
    {
      name: TEST_THUMBNAIL_ATTACHMENT_NAME,
      data: WEBHOOK_TEST_THUMBNAIL_JPEG,
      contentType: "image/jpeg",
    },
    {
      name: TEST_AVATAR_ATTACHMENT_NAME,
      data: WEBHOOK_TEST_AVATAR_PNG,
      contentType: "image/png",
    },
  ]
}

export interface ClipAnnouncement {
  clipUrl: string
  title: string
  authorUsername: string
  /** Server-relative path or absolute URL; null = no avatar. */
  authorImage: string | null
  /** Linked Discord account snowflake; null = author has no linked Discord. */
  authorDiscordId: string | null
  game: string | null
  /** Game page URL; null renders the game name as plain text. */
  gameUrl: string | null
  /** Game artwork (server-relative or absolute) for the embed thumbnail. */
  gameImageUrl: string | null
  durationMs: number | null
  /** Absolute URL of the embed image; null = no thumbnail. */
  thumbnailUrl: string | null
  createdAt: Date
}

export function clipPublicUrl(clipId: string): string {
  return `${serverOrigin()}/clips/${clipId}`
}

export function clipThumbnailUrl(clipId: string): string {
  return `${serverOrigin()}/api/clips/${clipId}/thumbnail`
}

export function gamePublicUrl(slug: string): string {
  return `${serverOrigin()}/games/${encodeURIComponent(slug)}`
}

export function announceTemplateValues(
  announcement: ClipAnnouncement,
): WebhookTemplateValues {
  return {
    clipUrl: announcement.clipUrl,
    title: announcement.title,
    author: announcement.authorUsername,
    game: announcement.game ?? "",
  }
}

/** Sample values for the admin "send test" flow of the generic webhook. */
export function testTemplateValues(): WebhookTemplateValues {
  return {
    clipUrl: `${serverOrigin()}/clips/test`,
    title: "Test clip",
    author: "Alloy",
    game: "Test game",
  }
}

/**
 * Fully-populated sample announcement for the admin "send test" flow: the
 * test message is exactly the announcement embed, with every data point
 * (author, game, duration, thumbnail) filled. Images come from the uploaded
 * attachments in {@link discordTestFiles}, never from URLs.
 */
export function discordTestPayload(): DiscordMessagePayload {
  return discordAnnouncePayload({
    clipUrl: serverOrigin(),
    title: "Insane ace clutch — webhook test",
    // A clearly user-shaped sample author, so the embed's author line is not
    // mistaken for instance branding (that lives in the footer).
    authorUsername: "clip-author",
    authorImage: `attachment://${TEST_AVATAR_ATTACHMENT_NAME}`,
    authorDiscordId: null,
    game: "Counter-Strike 2",
    gameUrl: `${serverOrigin()}/games`,
    gameImageUrl: `attachment://${LOGO_ATTACHMENT_NAME}`,
    durationMs: 27_000,
    thumbnailUrl: `attachment://${TEST_THUMBNAIL_ATTACHMENT_NAME}`,
    createdAt: new Date(),
  })
}

export interface DiscordMessagePayload {
  content?: string
  allowed_mentions?: { parse: string[] }
  embeds: unknown[]
}

/**
 * Rich-embed payload for the first-party Discord announcement. Styled after
 * link-preview bots like FxTwitter: linked author line, linked title, a
 * "game · duration" detail line, the thumbnail as full-width image, and an
 * instance-branded footer with the publish timestamp.
 */
export function discordAnnouncePayload(
  announcement: ClipAnnouncement,
): DiscordMessagePayload {
  const details = [
    announcement.game
      ? announcement.gameUrl
        ? `[${escapeMarkdownLinkText(announcement.game)}](${announcement.gameUrl})`
        : announcement.game
      : null,
    announcement.durationMs !== null && announcement.durationMs > 0
      ? formatDuration(announcement.durationMs)
      : null,
  ].filter((part): part is string => part !== null)
  return {
    // Credit the author's linked Discord account: the mention renders their
    // live Discord name, while allowed_mentions keeps it from pinging them.
    ...(announcement.authorDiscordId
      ? {
          content: `<@${announcement.authorDiscordId}>`,
          allowed_mentions: { parse: [] },
        }
      : {}),
    embeds: [
      {
        author: {
          name: announcement.authorUsername,
          url: `${serverOrigin()}/u/${encodeURIComponent(announcement.authorUsername)}`,
          ...(announcement.authorImage
            ? { icon_url: absoluteUrl(announcement.authorImage) }
            : {}),
        },
        title: announcement.title,
        url: announcement.clipUrl,
        ...(details.length > 0 ? { description: details.join(" · ") } : {}),
        color: EMBED_COLOR,
        // Game artwork sits in the small top-right thumbnail slot; the clip
        // poster stays the full-width image below.
        ...(announcement.gameImageUrl
          ? { thumbnail: { url: absoluteUrl(announcement.gameImageUrl) } }
          : {}),
        ...(announcement.thumbnailUrl
          ? { image: { url: announcement.thumbnailUrl } }
          : {}),
        footer: {
          text: "alloy",
          icon_url: `attachment://${LOGO_ATTACHMENT_NAME}`,
        },
        timestamp: announcement.createdAt.toISOString(),
      },
    ],
  }
}

export class GenericWebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "GenericWebhookError"
  }
}

/**
 * Fire the generic announce webhook: render the admin-provided JSON template
 * and POST it. Throws on an invalid template or a non-2xx response.
 */
export async function postGenericWebhook(
  config: Pick<GenericWebhookConfig, "url" | "template">,
  values: WebhookTemplateValues,
): Promise<void> {
  const body = renderWebhookTemplate(config.template, values)
  if (body === null) {
    throw new GenericWebhookError(
      "Generic webhook template is not valid JSON",
      null,
    )
  }
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new GenericWebhookError(
      `Generic webhook POST failed (${res.status})`,
      res.status,
    )
  }
}

function serverOrigin(): string {
  return env.PUBLIC_SERVER_URL.replace(/\/+$/, "")
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("/")) return `${serverOrigin()}${pathOrUrl}`
  // attachment:// references and already-absolute URLs pass through.
  return pathOrUrl
}

// Game names are untrusted display text inside a markdown link; escape the
// characters that would terminate or restructure the link.
function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (match) => `\\${match}`)
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
