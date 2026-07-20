import {
  renderWebhookTemplate,
  type GenericWebhookConfig,
  type WebhookTemplateValues,
} from "@alloy/contracts"
import { env } from "@alloy/server/env"

const REQUEST_TIMEOUT_MS = 10_000

// Alloy accent (dark theme) as a Discord embed color integer.
const EMBED_COLOR = 0x5d4f96

export interface ClipAnnouncement {
  clipUrl: string
  title: string
  authorUsername: string
  /** Server-relative path or absolute URL; null = no avatar. */
  authorImage: string | null
  /** Linked Discord account snowflake; null = author has no linked Discord. */
  authorDiscordId: string | null
  game: string | null
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
 * Fully-populated sample announcement for the admin "send test" flow, so the
 * test message previews the real embed — author, game, duration, and a
 * bundled blurred thumbnail served from the web build's public assets.
 */
export function discordTestPayload(): DiscordMessagePayload {
  return {
    ...discordAnnouncePayload({
      clipUrl: serverOrigin(),
      title: "Test clip — announcements will look like this",
      authorUsername: "Alloy",
      authorImage: "/logo.png",
      authorDiscordId: null,
      game: "Alloy",
      durationMs: 27_000,
      thumbnailUrl: `${serverOrigin()}/webhook-test-thumbnail.jpg`,
      createdAt: new Date(),
    }),
    content: "Webhook test — public clips will be announced like this.",
  }
}

export interface DiscordMessagePayload {
  content?: string
  allowed_mentions?: { parse: string[] }
  embeds: unknown[]
}

/** Rich-embed payload for the first-party Discord announcement. */
export function discordAnnouncePayload(
  announcement: ClipAnnouncement,
): DiscordMessagePayload {
  const fields: { name: string; value: string; inline: boolean }[] = []
  if (announcement.game) {
    fields.push({ name: "Game", value: announcement.game, inline: true })
  }
  if (announcement.durationMs !== null && announcement.durationMs > 0) {
    fields.push({
      name: "Duration",
      value: formatDuration(announcement.durationMs),
      inline: true,
    })
  }
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
        title: announcement.title,
        url: announcement.clipUrl,
        color: EMBED_COLOR,
        author: {
          name: announcement.authorUsername,
          ...(announcement.authorImage
            ? { icon_url: absoluteUrl(announcement.authorImage) }
            : {}),
        },
        ...(announcement.thumbnailUrl
          ? { image: { url: announcement.thumbnailUrl } }
          : {}),
        ...(fields.length > 0 ? { fields } : {}),
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
  return pathOrUrl
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
