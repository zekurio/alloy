import { z } from "zod"

/**
 * Placeholders available in the generic webhook JSON template. Values are
 * substituted JSON-escaped, so placeholders must sit inside JSON strings.
 */
export const WEBHOOK_TEMPLATE_PLACEHOLDERS = [
  "[clip_url]",
  "[title]",
  "[author]",
  "[game]",
] as const

export const DEFAULT_GENERIC_WEBHOOK_TEMPLATE = JSON.stringify(
  { content: "[author] published [title] — [clip_url]" },
  null,
  2,
)

export const DiscordWebhookConfigSchema = z.looseObject({
  enabled: z.boolean().default(false),
  /** Full Discord webhook URL; embeds a secret token, write-only in admin responses. */
  webhookUrl: z.string().default(""),
})

export type DiscordWebhookConfig = z.infer<typeof DiscordWebhookConfigSchema>

export const GenericWebhookConfigSchema = z.looseObject({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  /** JSON body template with `WEBHOOK_TEMPLATE_PLACEHOLDERS` substitution. */
  template: z.string().default(DEFAULT_GENERIC_WEBHOOK_TEMPLATE),
})

export type GenericWebhookConfig = z.infer<typeof GenericWebhookConfigSchema>

export const WebhooksConfigSchema = z.looseObject({
  discord: DiscordWebhookConfigSchema.default(
    DiscordWebhookConfigSchema.parse({}),
  ),
  generic: GenericWebhookConfigSchema.default(
    GenericWebhookConfigSchema.parse({}),
  ),
})

export type WebhooksConfig = z.infer<typeof WebhooksConfigSchema>

/**
 * Webhooks config as exposed to admins: the Discord webhook URL embeds a
 * secret token, so only its presence is reported (write-only semantics).
 */
export const AdminWebhooksConfigSchema = z.looseObject({
  discord: z.looseObject({
    enabled: z.boolean(),
    webhookUrlSet: z.boolean(),
  }),
  generic: GenericWebhookConfigSchema,
})

export type AdminWebhooksConfig = z.infer<typeof AdminWebhooksConfigSchema>

export const WEBHOOK_TEST_TARGETS = ["discord", "generic"] as const
export type WebhookTestTarget = (typeof WEBHOOK_TEST_TARGETS)[number]

// Accepts the canonical webhook hosts Discord hands out, including the PTB
// and Canary clients and the legacy discordapp.com domain.
const DISCORD_WEBHOOK_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "ptb.discordapp.com",
  "canary.discordapp.com",
])

export function isDiscordWebhookUrl(value: string): boolean {
  const url = URL.parse(value)
  if (!url) return false
  return (
    url.protocol === "https:" &&
    DISCORD_WEBHOOK_HOSTS.has(url.hostname) &&
    /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)
  )
}

export interface WebhookTemplateValues {
  clipUrl: string
  title: string
  author: string
  game: string
}

/**
 * Substitute placeholders into the generic webhook JSON template. Values are
 * escaped for JSON string context, so user-provided titles cannot break the
 * template's structure. Returns null when the result is not valid JSON.
 */
export function renderWebhookTemplate(
  template: string,
  values: WebhookTemplateValues,
): unknown | null {
  const escaped = (value: string) => JSON.stringify(value).slice(1, -1)
  const rendered = template
    .replaceAll("[clip_url]", escaped(values.clipUrl))
    .replaceAll("[title]", escaped(values.title))
    .replaceAll("[author]", escaped(values.author))
    .replaceAll("[game]", escaped(values.game))
  try {
    return JSON.parse(rendered)
  } catch {
    return null
  }
}

/** Whether a generic webhook template is valid JSON once placeholders resolve. */
export function isValidWebhookTemplate(template: string): boolean {
  return (
    renderWebhookTemplate(template, {
      clipUrl: "https://example.com/clips/id",
      title: "title",
      author: "author",
      game: "game",
    }) !== null
  )
}
