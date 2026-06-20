import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import {
  publishClipProgress,
  publishClipUpsert,
  publishClipUpsertById,
} from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm"

import { encodeLeaseConditions, RETRY_DELAY_INTERVAL } from "./lease-conditions"
import type {
  MediaRow,
  MediaSourcePatch,
  MediaStore,
  MediaThumbPatch,
} from "./media-store"

const logger = createLogger("queue")

const leaseConditions = () =>
  encodeLeaseConditions({
    status: clip.status,
    encodeProgress: clip.encodeProgress,
    encodeLockedAt: clip.encodeLockedAt,
  })

export const clipMediaStore: MediaStore = {
  target: "clip",

  async selectNextLeasableId(inFlight) {
    const rows = await db
      .select({ id: clip.id })
      .from(clip)
      .where(
        and(
          ...leaseConditions(),
          or(
            isNull(clip.failureReason),
            lt(
              clip.updatedAt,
              sql`now() - interval '${sql.raw(RETRY_DELAY_INTERVAL)}'`,
            ),
          ),
        ),
      )
      .orderBy(clip.updatedAt)
      .limit(inFlight.size + 1)
    return rows.find((row) => !inFlight.has(row.id))?.id ?? null
  },

  async lease(id, runId): Promise<MediaRow | null> {
    const [row] = await db
      .update(clip)
      .set({
        status: "processing",
        encodeRunId: runId,
        encodeLockedAt: new Date(),
        encodeAttempt: sql`${clip.encodeAttempt} + 1`,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, id), ...leaseConditions()))
      .returning()
    return row ?? null
  },

  async heartbeat(id, runId) {
    const rows = await db
      .update(clip)
      .set({ encodeLockedAt: new Date() })
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
    return rows.length > 0
  },

  async releaseLease(id, runId, reason) {
    await db
      .update(clip)
      .set({
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clip.id, id),
          eq(clip.encodeRunId, runId),
          ne(clip.status, "ready"),
        ),
      )
  },

  async markFailed(id, reason) {
    try {
      const [row] = await db
        .select({ status: clip.status })
        .from(clip)
        .where(eq(clip.id, id))
        .limit(1)
      if (row?.status === "ready") {
        await db
          .update(clip)
          .set({ failureReason: reason.slice(0, 500), updatedAt: new Date() })
          .where(eq(clip.id, id))
        return
      }
      await db
        .update(clip)
        .set({
          status: "failed",
          encodeRunId: null,
          encodeLockedAt: null,
          failureReason: reason.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(clip.id, id))
      await cleanupTickets({ type: "clip", id }, `terminal clip ${id} upload`)
      void publishClipUpsertById(id)
    } catch (err) {
      logger.error(`failed to mark clip ${id} as failed:`, err)
    }
  },

  async stillPresent(id, runId) {
    const [row] = await db
      .select({ id: clip.id })
      .from(clip)
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .limit(1)
    return Boolean(row)
  },

  async beginProcessing(id, runId) {
    const [row] = await db
      .update(clip)
      .set({
        status: "processing",
        encodeProgress: 0,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitProgress(id, runId, pct) {
    const rows = await db
      .update(clip)
      .set({ encodeProgress: pct, updatedAt: new Date() })
      .where(
        and(
          eq(clip.id, id),
          eq(clip.encodeRunId, runId),
          lt(clip.encodeProgress, pct),
        ),
      )
      .returning({ id: clip.id })
    return rows.length > 0
  },

  publishProgress(authorId, id, pct) {
    publishClipProgress(authorId, id, pct)
  },

  async commitSource(id, runId, patch: MediaSourcePatch) {
    const [row] = await db
      .update(clip)
      .set({
        ...patch,
        trimStartMs: null,
        trimEndMs: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitThumb(id, runId, patch: MediaThumbPatch) {
    const [row] = await db
      .update(clip)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
    return Boolean(row)
  },

  async commitReady(id, runId, patch) {
    const [updated] = await db
      .update(clip)
      .set({
        ...patch,
        status: "ready",
        encodeProgress: 100,
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, id), eq(clip.encodeRunId, runId)))
      .returning({ id: clip.id })
    return Boolean(updated)
  },

  async currentAssetKeys(id) {
    const [row] = await db
      .select({ sourceKey: clip.sourceKey, thumbKey: clip.thumbKey })
      .from(clip)
      .where(eq(clip.id, id))
      .limit(1)
    return row ?? null
  },

  async prewarmInput(id) {
    const [row] = await db
      .select({
        id: clip.id,
        sourceKey: clip.sourceKey,
        sourceSizeBytes: clip.sourceSizeBytes,
        updatedAt: clip.updatedAt,
      })
      .from(clip)
      .where(eq(clip.id, id))
      .limit(1)
    return row ?? null
  },

  publishUpsert(authorId, id) {
    void publishClipUpsert(authorId, id)
  },
}
