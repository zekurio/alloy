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
 * Fully-populated sample announcement for the admin "send test" flow: the
 * test message is exactly the announcement embed, with every data point
 * (author, game, duration, thumbnail) filled from server-embedded assets so
 * it renders regardless of web-build deploy state.
 */
export function discordTestPayload(): DiscordMessagePayload {
  return discordAnnouncePayload({
    clipUrl: serverOrigin(),
    title: "Insane ace clutch — webhook test",
    authorUsername: "alloy",
    authorImage: "/api/assets/webhook/logo.png",
    authorDiscordId: null,
    game: "Counter-Strike 2",
    durationMs: 27_000,
    thumbnailUrl: `${serverOrigin()}/api/assets/webhook/test-thumbnail.jpg`,
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
    announcement.game,
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
        ...(announcement.thumbnailUrl
          ? { image: { url: announcement.thumbnailUrl } }
          : {}),
        footer: {
          text: "Alloy",
          icon_url: `${serverOrigin()}/api/assets/webhook/logo.png`,
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
  return pathOrUrl
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
