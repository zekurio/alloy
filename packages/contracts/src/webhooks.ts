import { z } from "zod"

import type { IsoDateString } from "./shared"

/**
 * Where a webhook delivers. "discord" posts to a Discord webhook URL and lets
 * Discord unfurl the clip link; "generic" posts a signed JSON envelope to an
 * arbitrary endpoint.
 */
export const WEBHOOK_PROVIDERS = ["discord", "generic"] as const
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number]

/**
 * Events a webhook can carry. Only clip publication exists today; the wire
 * format names it explicitly so adding a second event later does not change
 * how existing receivers parse the envelope.
 */
export const WEBHOOK_EVENTS = ["clip.published"] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "succeeded",
  "failed",
] as const
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number]

export const WEBHOOK_NAME_MAX_LENGTH = 80
export const WEBHOOK_SECRET_MAX_LENGTH = 200

/** Header names a generic receiver uses to identify and verify a delivery. */
export const WEBHOOK_EVENT_HEADER = "X-Alloy-Event"
export const WEBHOOK_DELIVERY_HEADER = "X-Alloy-Delivery"
export const WEBHOOK_SIGNATURE_HEADER = "X-Alloy-Signature"

export const WebhookProviderSchema = z.enum(WEBHOOK_PROVIDERS)

/**
 * A webhook as an admin sees it. Credentials never round-trip: `secret` is
 * reported only as `secretSet`, and a Discord `url` arrives with its token
 * segment masked, so the list stays identifiable without leaking the token.
 */
export const AdminWebhookRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: WebhookProviderSchema,
  url: z.string(),
  secretSet: z.boolean(),
  enabled: z.boolean(),
  lastDeliveryAt: z.string().nullable(),
  lastDeliveryStatus: z.number().int().nullable(),
  lastDeliveryError: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AdminWebhookRow = z.infer<typeof AdminWebhookRowSchema>

export const AdminWebhookRowsSchema = z.array(AdminWebhookRowSchema)

export const AdminWebhookTestResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  error: z.string().nullable(),
})

export type AdminWebhookTestResult = z.infer<
  typeof AdminWebhookTestResultSchema
>

export interface AdminWebhookInput {
  name: string
  provider: WebhookProvider
  url: string
  secret?: string
  enabled?: boolean
}

/** Patch semantics: an absent `secret` keeps the stored one, "" clears it. */
export interface AdminWebhookPatch {
  name?: string
  url?: string
  secret?: string
  enabled?: boolean
}

/** The `clip.published` envelope delivered to generic webhooks. */
export interface ClipPublishedPayload {
  event: "clip.published"
  deliveryId: string
  timestamp: IsoDateString
  clip: {
    id: string
    url: string
    title: string
    description: string | null
    game: string
    durationMs: number | null
    thumbnailUrl: string | null
    videoUrl: string | null
    createdAt: IsoDateString
  }
  author: {
    id: string
    username: string
    displayName: string | null
    url: string
  }
}

// The canonical webhook hosts Discord hands out, including PTB and Canary.
const DISCORD_WEBHOOK_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
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

/**
 * Hide the token segment of a Discord webhook URL so a webhook stays
 * recognisable in the admin list without handing the token back to the client.
 * Non-Discord URLs are returned unchanged: they are an endpoint the admin
 * typed, and the signing secret — not the URL — is the generic credential.
 */
export function maskWebhookUrl(provider: WebhookProvider, url: string): string {
  if (provider !== "discord") return url
  const parsed = URL.parse(url)
  if (!parsed) return url
  const segments = parsed.pathname.split("/")
  if (segments.length < 2) return url
  // ASCII on purpose: the URL serializer would percent-encode "••••".
  segments[segments.length - 1] = "****"
  parsed.pathname = segments.join("/")
  return parsed.toString()
}
