import { stagingRecording } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
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
    status: stagingRecording.status,
    encodeProgress: stagingRecording.encodeProgress,
    encodeLockedAt: stagingRecording.encodeLockedAt,
  })

/**
 * Media store for owner-only staging recordings. Same pipeline as clips, but
 * with no privacy, no follower notifications, and no SSE — the owner library
 * polls the row while it processes.
 */
export const stagingMediaStore: MediaStore = {
  target: "staging",

  async selectNextLeasableId(inFlight) {
    const rows = await db
      .select({ id: stagingRecording.id })
      .from(stagingRecording)
      .where(
        and(
          ...leaseConditions(),
          or(
            isNull(stagingRecording.failureReason),
            lt(
              stagingRecording.updatedAt,
              sql`now() - interval '${sql.raw(RETRY_DELAY_INTERVAL)}'`,
            ),
          ),
        ),
      )
      .orderBy(stagingRecording.updatedAt)
      .limit(inFlight.size + 1)
    return rows.find((row) => !inFlight.has(row.id))?.id ?? null
  },

  async lease(id, runId): Promise<MediaRow | null> {
    const [row] = await db
      .update(stagingRecording)
      .set({
        status: "processing",
        encodeRunId: runId,
        encodeLockedAt: new Date(),
        encodeAttempt: sql`${stagingRecording.encodeAttempt} + 1`,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(stagingRecording.id, id), ...leaseConditions()))
      .returning()
    return row ?? null
  },

  async heartbeat(id, runId) {
    const rows = await db
      .update(stagingRecording)
      .set({ encodeLockedAt: new Date() })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .returning({ id: stagingRecording.id })
    return rows.length > 0
  },

  async releaseLease(id, runId, reason) {
    await db
      .update(stagingRecording)
      .set({
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
          ne(stagingRecording.status, "ready"),
        ),
      )
  },

  async markFailed(id, reason) {
    try {
      const [row] = await db
        .select({ status: stagingRecording.status })
        .from(stagingRecording)
        .where(eq(stagingRecording.id, id))
        .limit(1)
      if (row?.status === "ready") {
        await db
          .update(stagingRecording)
          .set({ failureReason: reason.slice(0, 500), updatedAt: new Date() })
          .where(eq(stagingRecording.id, id))
        return
      }
      await db
        .update(stagingRecording)
        .set({
          status: "failed",
          encodeRunId: null,
          encodeLockedAt: null,
          failureReason: reason.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(stagingRecording.id, id))
      await cleanupTickets(
        { type: "staging", id },
        `terminal staging ${id} upload`,
      )
    } catch (err) {
      logger.error(`failed to mark staging recording ${id} as failed:`, err)
    }
  },

  async stillPresent(id, runId) {
    const [row] = await db
      .select({ id: stagingRecording.id })
      .from(stagingRecording)
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .limit(1)
    return Boolean(row)
  },

  async beginProcessing(id, runId) {
    const [row] = await db
      .update(stagingRecording)
      .set({
        status: "processing",
        encodeProgress: 0,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .returning({ id: stagingRecording.id })
    return Boolean(row)
  },

  async commitProgress(id, runId, pct) {
    const rows = await db
      .update(stagingRecording)
      .set({ encodeProgress: pct, updatedAt: new Date() })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
          lt(stagingRecording.encodeProgress, pct),
        ),
      )
      .returning({ id: stagingRecording.id })
    return rows.length > 0
  },

  publishProgress() {
    // Staging is owner-only; the library polls the row while it processes.
  },

  async commitSource(id, runId, patch: MediaSourcePatch) {
    const [row] = await db
      .update(stagingRecording)
      .set({
        ...patch,
        trimStartMs: null,
        trimEndMs: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .returning({ id: stagingRecording.id })
    return Boolean(row)
  },

  async commitThumb(id, runId, patch: MediaThumbPatch) {
    const [row] = await db
      .update(stagingRecording)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .returning({ id: stagingRecording.id })
    return Boolean(row)
  },

  async commitReady(id, runId, patch) {
    const [row] = await db
      .update(stagingRecording)
      .set({
        ...patch,
        status: "ready",
        encodeProgress: 100,
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagingRecording.id, id),
          eq(stagingRecording.encodeRunId, runId),
        ),
      )
      .returning({ id: stagingRecording.id })
    return Boolean(row)
  },

  async currentAssetKeys(id) {
    const [row] = await db
      .select({
        sourceKey: stagingRecording.sourceKey,
        thumbKey: stagingRecording.thumbKey,
      })
      .from(stagingRecording)
      .where(eq(stagingRecording.id, id))
      .limit(1)
    return row ?? null
  },

  async prewarmInput() {
    // Staging recordings are never HLS-streamed (the editor uses /stream); the
    // HLS package is built lazily for the published clip instead.
    return null
  },

  publishUpsert() {
    // No SSE channel for staging recordings (owner-only, polled).
  },
}
