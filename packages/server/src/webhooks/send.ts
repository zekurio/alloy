import { createHmac } from "node:crypto"

import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEvent,
  type WebhookProvider,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { errorMessage } from "@alloy/server/runtime/error-message"

const REQUEST_TIMEOUT_MS = 10_000
const ERROR_BODY_MAX_CHARS = 200
const DiscordMessage = t.object({ id: t.string().regex(/^\d+$/) })
const DiscordError = t.object({ code: t.number() })

export interface WebhookTarget {
  provider: WebhookProvider
  url: string
  secret: string | null
}

export interface WebhookMessage {
  deliveryId: string
  event: WebhookEvent | "test"
  /** What Discord posts as message content. */
  content: string
  /** What a generic endpoint receives as the JSON body. */
  body: unknown
  /** Edit this Discord message; other providers always receive a new post. */
  discordMessageId?: string
}

export type WebhookSendResult =
  | { ok: true; status: number; discordMessageId?: string }
  | { ok: false; status: number | null; error: string }

/**
 * Deliver one message to one webhook.
 *
 * Returns a result rather than throwing: the admin "send test" flow reports
 * the outcome verbatim, and the delivery job records it before deciding
 * whether to retry.
 */
export async function sendWebhook(
  target: WebhookTarget,
  message: WebhookMessage,
  signal?: AbortSignal,
): Promise<WebhookSendResult> {
  const body =
    target.provider === "discord"
      ? JSON.stringify({ content: message.content })
      : JSON.stringify(message.body)

  const headers = new Headers({
    "content-type": "application/json",
  })
  if (target.provider === "generic") {
    headers.set(WEBHOOK_EVENT_HEADER, message.event)
    headers.set(WEBHOOK_DELIVERY_HEADER, message.deliveryId)
    if (target.secret) {
      headers.set(
        WEBHOOK_SIGNATURE_HEADER,
        signWebhookBody(body, target.secret),
      )
    }
  }

  // redirect: "error" — a webhook endpoint that redirects is misconfigured or
  // hostile, and following it would send the signature to an unintended host.
  const url = new URL(target.url)
  const editing = target.provider === "discord" && message.discordMessageId
  if (editing) {
    url.pathname += `/messages/${encodeURIComponent(editing)}`
    const threadId = url.searchParams.get("thread_id")
    url.search = ""
    if (threadId) url.searchParams.set("thread_id", threadId)
  } else if (target.provider === "discord") {
    url.searchParams.set("wait", "true")
  }
  const result = await fetch(url, {
    method: editing ? "PATCH" : "POST",
    headers,
    body,
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(
    (response) => ({ response }),
    (cause: unknown) => ({
      error: errorMessage(cause, "Webhook request failed"),
    }),
  )

  if ("error" in result) {
    return { ok: false, status: null, error: result.error }
  }
  const response = result.response
  if (response.ok) {
    if (target.provider === "discord") {
      const message = DiscordMessage.safeParse(
        await response.json().catch(() => null),
      )
      if (message.success) {
        return {
          ok: true,
          status: response.status,
          discordMessageId: message.data.id,
        }
      }
      // A successful post with an unreadable response must not be reposted.
      if (editing) {
        return { ok: true, status: response.status, discordMessageId: editing }
      }
    }
    return { ok: true, status: response.status }
  }

  if (editing && response.status === 404) {
    const error = DiscordError.safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    )
    // Only Unknown Message permits a replacement. Missing webhooks, permission
    // errors, and temporary failures must follow the normal delivery retries.
    if (error.success && error.data.code === 10008) {
      return sendWebhook(
        target,
        { ...message, discordMessageId: undefined },
        signal,
      )
    }
  }

  const detail = await response.text().catch(() => "")
  return {
    ok: false,
    status: response.status,
    error: detail
      ? `${response.status}: ${detail.slice(0, ERROR_BODY_MAX_CHARS)}`
      : `Endpoint responded ${response.status}`,
  }
}

/**
 * HMAC-SHA256 over the exact bytes that go on the wire, so a receiver can
 * verify without re-serialising (and re-ordering) the JSON.
 */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}
