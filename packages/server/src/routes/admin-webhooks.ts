import { randomUUID } from "node:crypto"

import {
  isDiscordWebhookUrl,
  maskWebhookUrl,
  WEBHOOK_NAME_MAX_LENGTH,
  WEBHOOK_PROVIDERS,
  WEBHOOK_SECRET_MAX_LENGTH,
  type AdminWebhookRow,
  type WebhookProvider,
} from "@alloy/contracts"
import { webhook } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import {
  badRequest,
  deleted,
  notFound,
} from "@alloy/server/runtime/http-response"
import { postWebhook } from "@alloy/server/webhooks/send"
import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { requiredTrimmedString, zValidator } from "./validation"

const TEST_DISCORD_CONTENT =
  "Alloy webhook test — published clips will be posted here as links that unfurl into a playable preview."

const WebhookIdParam = z.object({ id: z.uuid() })

const CreateWebhookBody = z.object({
  name: requiredTrimmedString(WEBHOOK_NAME_MAX_LENGTH),
  provider: z.enum(WEBHOOK_PROVIDERS),
  url: requiredTrimmedString(2048),
  secret: z.string().trim().max(WEBHOOK_SECRET_MAX_LENGTH).optional(),
  enabled: z.boolean().optional(),
})

const UpdateWebhookBody = z
  .object({
    name: requiredTrimmedString(WEBHOOK_NAME_MAX_LENGTH).optional(),
    url: requiredTrimmedString(2048).optional(),
    // Absent keeps the stored secret; "" clears it.
    secret: z.string().trim().max(WEBHOOK_SECRET_MAX_LENGTH).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No updates provided",
  })

export const adminWebhooksRoute = new Hono()
  .get("/webhooks", async (c) => {
    const rows = await db
      .select()
      .from(webhook)
      .orderBy(desc(webhook.created_at))
    return c.json(rows.map(toAdminWebhookRow))
  })
  .post("/webhooks", zValidator("json", CreateWebhookBody), async (c) => {
    const body = c.req.valid("json")
    const invalid = webhookUrlProblem(body.provider, body.url)
    if (invalid) return badRequest(c, invalid)

    const [row] = await db
      .insert(webhook)
      .values({
        name: body.name,
        provider: body.provider,
        url: body.url,
        secret: body.secret || null,
        enabled: body.enabled ?? true,
      })
      .returning()
    return c.json(toAdminWebhookRow(row))
  })
  .patch(
    "/webhooks/:id",
    zValidator("param", WebhookIdParam),
    zValidator("json", UpdateWebhookBody),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const existing = await selectWebhook(id)
      if (!existing) return notFound(c, "Webhook not found")

      if (body.url !== undefined) {
        const invalid = webhookUrlProblem(existing.provider, body.url)
        if (invalid) return badRequest(c, invalid)
      }

      const [row] = await db
        .update(webhook)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.url !== undefined && { url: body.url }),
          ...(body.secret !== undefined && { secret: body.secret || null }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          updated_at: new Date(),
        })
        .where(eq(webhook.id, id))
        .returning()
      return c.json(toAdminWebhookRow(row))
    },
  )
  .delete("/webhooks/:id", zValidator("param", WebhookIdParam), async (c) => {
    const { id } = c.req.valid("param")
    const [row] = await db
      .delete(webhook)
      .where(eq(webhook.id, id))
      .returning({ id: webhook.id })
    if (!row) return notFound(c, "Webhook not found")
    return deleted(c)
  })
  .post(
    "/webhooks/:id/test",
    zValidator("param", WebhookIdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      const row = await selectWebhook(id)
      if (!row) return notFound(c, "Webhook not found")

      const deliveryId = randomUUID()
      // Deliberately does not touch webhook_delivery: a test is not an
      // announcement, and recording one would consume nothing and prove
      // nothing about which clips have been sent.
      const result = await postWebhook(
        { provider: row.provider, url: row.url, secret: row.secret },
        {
          deliveryId,
          event: "test",
          content: TEST_DISCORD_CONTENT,
          body: {
            event: "test",
            deliveryId,
            timestamp: new Date().toISOString(),
          },
        },
      )
      return c.json({
        ok: result.ok,
        status: result.status,
        error: result.ok ? null : result.error,
      })
    },
  )

function selectWebhook(id: string) {
  return db.query.webhook.findFirst({ where: eq(webhook.id, id) })
}

/**
 * Endpoint sanity, not reachability.
 *
 * Unlike user-supplied avatar URLs (see media/remote-image.ts) there is no
 * private-address guard here: only admins reach this route, and a self-hosted
 * instance announcing to a bot on the same box or LAN is the normal case, not
 * an attack. postWebhook still refuses to follow redirects, so a signed body
 * cannot be bounced to an unintended host.
 */
function webhookUrlProblem(
  provider: WebhookProvider,
  url: string,
): string | null {
  if (provider === "discord") {
    return isDiscordWebhookUrl(url)
      ? null
      : "Enter a Discord webhook URL, e.g. https://discord.com/api/webhooks/<id>/<token>"
  }
  const parsed = URL.parse(url)
  if (
    !parsed ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    return "Enter an http:// or https:// endpoint URL"
  }
  return null
}

function toAdminWebhookRow(row: typeof webhook.$inferSelect): AdminWebhookRow {
  // Annotated deliberately: credentials must never round-trip, so the shape
  // that leaves this route is compile-checked against the contract.
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    url: maskWebhookUrl(row.provider, row.url),
    secretSet: Boolean(row.secret),
    enabled: row.enabled,
    lastDeliveryAt: nullableIsoDate(row.last_delivery_at),
    lastDeliveryStatus: row.last_delivery_status,
    lastDeliveryError: row.last_delivery_error,
    consecutiveFailures: row.consecutive_failures,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}
