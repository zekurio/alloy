import { randomUUID } from "node:crypto"

import { requireAdmin } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import { conflict, noContent } from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import {
  claimClipPublishedDeliveries,
  wakeClaimedClipPublishedDeliveries,
} from "@alloy/server/webhooks/publish"
import { Hono } from "hono"

import { IdParam } from "./clips-helpers"
import { tbValidator } from "./validation"

const reannounceRateLimit = rateLimiter({
  windowMs: 60_000,
  max: 3,
  key: requestIp,
})

export const clipsAnnouncementRoutes = new Hono().post(
  "/:id/reannounce",
  requireAdmin,
  reannounceRateLimit,
  tbValidator("param", IdParam),
  async (c) => {
    const { id } = c.req.valid("param")
    // A manual announcement gets its own ledger entry; automatic publication
    // retains its original dedup key and cannot repost on privacy changes.
    const claimed = await claimClipPublishedDeliveries(
      db,
      id,
      `clip.reannounce:${id}:${randomUUID()}`,
    )
    if (claimed === 0) {
      return conflict(
        c,
        "Reannounce requires a public clip with an OG rendition, author announcements enabled, and an enabled webhook",
      )
    }
    wakeClaimedClipPublishedDeliveries(claimed)
    return noContent(c)
  },
)
