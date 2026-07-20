import {
  renderWebhookTemplate,
  type GenericWebhookConfig,
  type WebhookTemplateValues,
} from "@alloy/contracts"
import { env } from "@alloy/server/env"

const REQUEST_TIMEOUT_MS = 10_000

export interface ClipAnnouncement {
  clipUrl: string
  title: string
  authorUsername: string
  game: string | null
}

export function clipPublicUrl(clipId: string): string {
  return `${serverOrigin()}/clips/${clipId}`
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

export interface DiscordMessagePayload {
  content: string
}

/**
 * Discord announcement: the bare clip link. Custom webhook embeds cannot
 * contain playable video (the embed `video` field is reserved for Discord's
 * own unfurler), so the message is the URL and Discord unfurls it through
 * the clip page's OpenGraph tags — title, author/game description with
 * engagement stats, and an inline video player.
 */
export function discordAnnouncePayload(
  announcement: ClipAnnouncement,
): DiscordMessagePayload {
  return { content: announcement.clipUrl }
}

/** Admin "send test" message; there is no clip to link, so plain text. */
export function discordTestPayload(): DiscordMessagePayload {
  return {
    content:
      "Alloy webhook test — public clips will be posted here as links that unfurl into a playable preview.",
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
