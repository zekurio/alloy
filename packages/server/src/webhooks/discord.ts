import { z } from "zod"

const REQUEST_TIMEOUT_MS = 10_000

export class DiscordWebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "DiscordWebhookError"
  }
}

const ExecuteResponseSchema = z.object({ id: z.string() })

/**
 * Execute a Discord webhook with `?wait=true` so Discord returns the created
 * message; the message id is what later retraction deletes.
 */
export async function executeDiscordWebhook(
  webhookUrl: string,
  payload: unknown,
): Promise<{ messageId: string }> {
  const res = await discordFetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await responseError(res, "Discord webhook execute failed")
  const parsed = ExecuteResponseSchema.safeParse(await res.json())
  if (!parsed.success) {
    throw new DiscordWebhookError(
      "Discord webhook execute returned an unexpected response",
      res.status,
    )
  }
  return { messageId: parsed.data.id }
}

/**
 * Delete a previously announced webhook message. A 404 means the message (or
 * the webhook itself) is already gone and is treated as success.
 */
export async function deleteDiscordWebhookMessage(
  webhookUrl: string,
  messageId: string,
): Promise<void> {
  const res = await discordFetch(`${webhookUrl}/messages/${messageId}`, {
    method: "DELETE",
  })
  if (res.ok || res.status === 404) return
  throw await responseError(res, "Discord webhook message delete failed")
}

function discordFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function responseError(
  res: Response,
  prefix: string,
): Promise<DiscordWebhookError> {
  const body = await res.text().catch(() => "")
  const detail = body ? `: ${body.slice(0, 200)}` : ""
  return new DiscordWebhookError(
    `${prefix} (${res.status})${detail}`,
    res.status,
  )
}
