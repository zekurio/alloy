import { normalizeTags } from "@alloy/contracts"
import {
  clip,
  clipMention,
  clipTag,
  game,
  gameSession,
  stagingRecording,
  userDevice,
} from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  ensureDirectHlsPackage,
  makeDirectHlsSpec,
} from "@alloy/server/clips/direct-hls"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { notifyFollowersOfNewClip } from "@alloy/server/notifications/index"
import {
  cancelStagingMediaProcessing,
  enqueueStagingMediaProcessing,
} from "@alloy/server/queue/index"
import {
  badRequest,
  conflict,
  deleted,
  gone,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import {
  selectStagingForOwner,
  stagingRowResponse,
} from "@alloy/server/staging/access"
import {
  selectStagingById,
  stagingSelectShape,
  toStagingRow,
} from "@alloy/server/staging/select"
import { clipStorage } from "@alloy/server/storage/index"
import {
  deleteStagedUpload,
  mintStagedUploadUrl,
  resolveStagedUpload,
  stagedSourceKey,
  stagedThumbKey,
} from "@alloy/server/uploads/staged"
import {
  assertUsableVideoTicket,
  cleanupTickets,
  createUploadTickets,
  selectVideoTicketKey,
  THUMB_UPLOAD_MAX_BYTES,
} from "@alloy/server/uploads/tickets"
import { and, desc, eq, gt, lt, or, type SQL } from "drizzle-orm"
import { Hono } from "hono"

import { StreamQuery, TRIM_MIN_RANGE_MS, TrimBody } from "./clips-helpers"
import { streamResolved, streamThumbnail } from "./clips-playback-streams"
import {
  resolveMentionIds,
  selectLockedQuotaState,
  type UploadQuotaResult,
  uploadWouldExceedQuota,
} from "./clips-upload-helpers"
import { redirectToStorageUrl } from "./media-redirect"
import {
  encodeStagingCursor,
  InitiateStagingBody,
  parseStagingCursor,
  PublishStagingBody,
  resolvePublishGame,
  resolveStagingGame,
  StagingIdParam,
  StagingListQuery,
  UpdateStagingBody,
} from "./staging-helpers"
import { zValidator } from "./validation"

const logger = createLogger("staging")

const TRIM_FULL_RANGE_TOLERANCE_MS = 50
const STAGING_CACHE_CONTROL = "private, no-store"

async function markStagingFailed(id: string, reason: string): Promise<void> {
  await db
    .update(stagingRecording)
    .set({
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(stagingRecording.id, id))
}

export const stagingRoutes = new Hono()
  .get(
    "/",
    requireSession,
    zValidator("query", StagingListQuery),
    async (c) => {
      const viewerId = c.var.viewerId
      const { kind, limit, cursor } = c.req.valid("query")
      const parsed = parseStagingCursor(cursor)
      if (cursor && !parsed) return badRequest(c, "Invalid cursor")

      const conditions: SQL[] = [eq(stagingRecording.authorId, viewerId)]
      if (kind) conditions.push(eq(stagingRecording.kind, kind))
      if (parsed) {
        const keyset = or(
          lt(stagingRecording.createdAt, parsed.createdAt),
          and(
            eq(stagingRecording.createdAt, parsed.createdAt),
            gt(stagingRecording.id, parsed.id),
          ),
        )
        if (keyset) conditions.push(keyset)
      }

      const rows = await db
        .select(stagingSelectShape)
        .from(stagingRecording)
        .leftJoin(game, eq(stagingRecording.steamgriddbId, game.steamgriddbId))
        .where(and(...conditions))
        .orderBy(desc(stagingRecording.createdAt), stagingRecording.id)
        .limit(limit + 1)

      const pageRows = rows.slice(0, limit)
      const tail = pageRows[pageRows.length - 1]
      return c.json({
        items: pageRows.map(toStagingRow),
        nextCursor:
          rows.length > limit && tail ? encodeStagingCursor(tail) : null,
      })
    },
  )
  .post(
    "/initiate",
    requireSession,
    zValidator("json", InitiateStagingBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const body = c.req.valid("json")

      const stagingId = crypto.randomUUID()
      const uploadKey = stagedSourceKey(stagingId, body.contentType)
      const thumbUploadKey = stagedThumbKey(stagingId)

      const resolved = await resolveStagingGame(
        { steamgriddbId: body.steamgriddbId, gameName: body.gameName },
        viewerId,
      )

      if (body.originDeviceId) {
        const [device] = await db
          .select({ id: userDevice.id })
          .from(userDevice)
          .where(
            and(
              eq(userDevice.id, body.originDeviceId),
              eq(userDevice.userId, viewerId),
            ),
          )
          .limit(1)
        if (!device) return badRequest(c, "Unknown device")
      }
      if (body.gameSessionId) {
        const [session] = await db
          .select({ id: gameSession.id })
          .from(gameSession)
          .where(
            and(
              eq(gameSession.id, body.gameSessionId),
              eq(gameSession.userId, viewerId),
            ),
          )
          .limit(1)
        if (!session) return badRequest(c, "Unknown play session")
      }

      const tags = body.tags ? normalizeTags(body.tags) : []

      const quotaResult = await db.transaction<UploadQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId,
          )
          if (
            quotaBytes !== null &&
            uploadWouldExceedQuota({
              quotaBytes,
              usedBytes,
              incomingBytes: body.sizeBytes,
            })
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          await tx.insert(stagingRecording).values({
            id: stagingId,
            authorId: viewerId,
            kind: body.kind,
            title: body.title,
            description: body.description ?? null,
            game: resolved.game,
            steamgriddbId: resolved.steamgriddbId,
            originDeviceId: body.originDeviceId ?? null,
            gameSessionId: body.gameSessionId ?? null,
            sourceContentType: body.contentType,
            sourceSizeBytes: body.sizeBytes,
            thumbBlurHash: body.thumbBlurHash ?? null,
            tags,
            status: "pending",
          })
          return { ok: true }
        },
      )

      if (!quotaResult.ok) {
        return c.json(
          {
            error: "Storage quota exceeded",
            usedBytes: quotaResult.usedBytes,
            quotaBytes: quotaResult.quotaBytes,
          },
          413,
        )
      }

      const expiresInSec = configStore.get("limits").uploadTtlSec
      const expiresAt = new Date(Date.now() + expiresInSec * 1000)
      try {
        await createUploadTickets({
          target: { type: "staging", id: stagingId },
          ownerId: viewerId,
          videoKey: uploadKey,
          videoContentType: body.contentType,
          videoBytes: body.sizeBytes,
          thumbKey: thumbUploadKey,
          thumbContentType: body.thumbContentType,
          expiresAt,
        })
        const ticket = await mintStagedUploadUrl({
          key: uploadKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId: stagingId,
        })
        const thumbTicket = await mintStagedUploadUrl({
          key: thumbUploadKey,
          contentType: body.thumbContentType,
          maxBytes: THUMB_UPLOAD_MAX_BYTES,
          expiresInSec,
          userId: viewerId,
          clipId: stagingId,
        })
        return c.json({ stagingId, ticket, thumbTicket })
      } catch (err) {
        await db
          .delete(stagingRecording)
          .where(eq(stagingRecording.id, stagingId))
        await deleteStagedUpload(uploadKey)
        throw err
      }
    },
  )
  .post(
    "/:id/finalize",
    requireSession,
    zValidator("param", StagingIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const access = await selectStagingForOwner(c, {
        id,
        viewerId,
        statuses: ["pending"],
      })
      if ("response" in access) return access.response
      const row = access.row

      const videoTicketKey = await selectVideoTicketKey({ type: "staging", id })
      const sourceContentType = row.sourceContentType
      const sourceSizeBytes = row.sourceSizeBytes
      if (!videoTicketKey || !sourceContentType || sourceSizeBytes == null) {
        await markStagingFailed(id, "Upload ticket missing")
        return badRequest(c, "Upload ticket missing")
      }

      const ticketOk = await assertUsableVideoTicket({
        target: { type: "staging", id },
        storageKey: videoTicketKey,
        contentType: sourceContentType,
        expectedBytes: sourceSizeBytes,
      })
      if (!ticketOk) {
        await deleteStagedUpload(videoTicketKey)
        await markStagingFailed(id, "Upload ticket expired")
        return gone(c, "Upload ticket expired")
      }

      const stagedUpload = await resolveStagedUpload(videoTicketKey)
      if (!stagedUpload) {
        await deleteStagedUpload(videoTicketKey)
        await markStagingFailed(id, "Upload bytes are missing")
        return badRequest(c, "Upload bytes are missing")
      }

      const quotaResult = await db.transaction<UploadQuotaResult>(
        async (tx) => {
          const { quotaBytes, usedBytes } = await selectLockedQuotaState(
            tx,
            viewerId,
          )
          if (
            quotaBytes !== null &&
            uploadWouldExceedQuota({
              quotaBytes,
              usedBytes,
              reservedBytes: sourceSizeBytes,
              incomingBytes: stagedUpload.size,
            })
          ) {
            return { ok: false, usedBytes, quotaBytes }
          }
          return { ok: true }
        },
      )
      if (!quotaResult.ok) {
        await deleteStagedUpload(videoTicketKey)
        await markStagingFailed(id, "Storage quota exceeded")
        return c.json(
          {
            error: "Storage quota exceeded",
            usedBytes: quotaResult.usedBytes,
            quotaBytes: quotaResult.quotaBytes,
          },
          413,
        )
      }

      if (stagedUpload.size !== sourceSizeBytes) {
        await deleteStagedUpload(videoTicketKey)
        await markStagingFailed(id, "Upload size did not match declared size")
        return badRequest(c, "Upload size did not match declared size")
      }

      const [transitioned] = await db
        .update(stagingRecording)
        .set({
          status: "processing",
          sourceSizeBytes: stagedUpload.size,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stagingRecording.id, id),
            eq(stagingRecording.authorId, viewerId),
            eq(stagingRecording.status, "pending"),
          ),
        )
        .returning({ id: stagingRecording.id })
      if (!transitioned)
        return conflict(c, "Recording is already being finalized")

      enqueueStagingMediaProcessing(id)
      return stagingRowResponse(c, id, viewerId)
    },
  )
  .post(
    "/:id/fail",
    requireSession,
    zValidator("param", StagingIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const access = await selectStagingForOwner(c, {
        id,
        viewerId,
        statuses: ["pending", "processing"],
      })
      if ("response" in access) return access.response

      await cleanupTickets({ type: "staging", id }, "failed staging upload")
      await markStagingFailed(id, "Upload failed")
      return success(c)
    },
  )
  .get(
    "/:id",
    requireSession,
    zValidator("param", StagingIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const row = await selectStagingById(id, viewerId)
      if (!row) return notFound(c)
      return c.json(toStagingRow(row))
    },
  )
  .patch(
    "/:id",
    requireSession,
    zValidator("param", StagingIdParam),
    zValidator("json", UpdateStagingBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectStagingForOwner(c, { id, viewerId })
      if ("response" in access) return access.response

      const patch: Partial<typeof stagingRecording.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (body.kind !== undefined) patch.kind = body.kind
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) {
        patch.description = body.description === "" ? null : body.description
      }
      if (body.clearGame) {
        patch.steamgriddbId = null
        patch.game = null
      } else if (
        body.steamgriddbId !== undefined ||
        body.gameName !== undefined
      ) {
        const resolved = await resolveStagingGame(
          { steamgriddbId: body.steamgriddbId, gameName: body.gameName },
          viewerId,
        )
        patch.steamgriddbId = resolved.steamgriddbId
        patch.game = resolved.game
      }
      if (body.tags !== undefined) patch.tags = normalizeTags(body.tags)

      await db
        .update(stagingRecording)
        .set(patch)
        .where(eq(stagingRecording.id, id))

      return stagingRowResponse(c, id, viewerId)
    },
  )
  .post(
    "/:id/trim",
    requireSession,
    zValidator("param", StagingIdParam),
    zValidator("json", TrimBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectStagingForOwner(c, {
        id,
        viewerId,
        statuses: ["ready"],
      })
      if ("response" in access) return access.response
      const row = access.row

      if (!row.sourceKey) return badRequest(c, "Recording has no source media")
      const durationMs = row.durationMs
      if (durationMs == null || durationMs <= 0) {
        return badRequest(c, "Recording duration is unknown")
      }

      const startMs = Math.max(0, body.startMs)
      const endMs = Math.min(durationMs, body.endMs)
      if (endMs - startMs < TRIM_MIN_RANGE_MS) {
        return badRequest(c, "The trimmed range is too short")
      }
      if (
        startMs <= TRIM_FULL_RANGE_TOLERANCE_MS &&
        endMs >= durationMs - TRIM_FULL_RANGE_TOLERANCE_MS
      ) {
        return badRequest(c, "The trim covers the whole recording")
      }

      const [accepted] = await db
        .update(stagingRecording)
        .set({
          trimStartMs: startMs,
          trimEndMs: endMs,
          status: "processing",
          encodeProgress: 0,
          encodeAttempt: 0,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stagingRecording.id, id),
            eq(stagingRecording.authorId, viewerId),
            eq(stagingRecording.status, "ready"),
          ),
        )
        .returning({ id: stagingRecording.id })
      if (!accepted) return conflict(c, "Recording is already processing")

      enqueueStagingMediaProcessing(id)
      return stagingRowResponse(c, id, viewerId)
    },
  )
  .post(
    "/:id/publish",
    requireSession,
    zValidator("param", StagingIdParam),
    zValidator("json", PublishStagingBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectStagingForOwner(c, {
        id,
        viewerId,
        statuses: ["ready"],
      })
      if ("response" in access) return access.response
      const row = access.row

      if (!row.sourceKey || row.sourceContentType == null) {
        return badRequest(c, "Recording has no published media")
      }

      const resolvedGame = await resolvePublishGame(
        {
          steamgriddbId: body.steamgriddbId ?? row.steamgriddbId ?? undefined,
          gameName: body.gameName ?? row.game ?? undefined,
        },
        viewerId,
      )
      if (!resolvedGame) return c.json({ error: "game-unresolved" }, 422)

      // Promote in place: the published clip reuses the staging recording's id
      // (and its stored media), so a desktop capture's syncedRecordingId still
      // resolves to it and collapses into the clip card in the library.
      const clipId = id
      const tags = normalizeTags(body.tags ?? row.tags)
      const mentionedIds = body.mentionedUserIds
        ? await resolveMentionIds(body.mentionedUserIds, viewerId)
        : []

      await db.transaction(async (tx) => {
        await tx.insert(clip).values({
          id: clipId,
          authorId: viewerId,
          title: body.title ?? row.title,
          description: body.description ?? row.description,
          game: resolvedGame.game,
          steamgriddbId: resolvedGame.steamgriddbId,
          privacy: body.privacy,
          originDeviceId: row.originDeviceId,
          gameSessionId: row.gameSessionId,
          // Reuse the staging media in place — no re-upload, no re-encode.
          sourceKey: row.sourceKey,
          sourceContentType: row.sourceContentType,
          sourceVideoCodec: row.sourceVideoCodec,
          sourceAudioCodec: row.sourceAudioCodec,
          sourceSizeBytes: row.sourceSizeBytes,
          durationMs: row.durationMs,
          width: row.width,
          height: row.height,
          thumbKey: row.thumbKey,
          thumbBlurHash: row.thumbBlurHash,
          status: "ready",
          encodeProgress: 100,
        })
        if (mentionedIds.length > 0) {
          await tx.insert(clipMention).values(
            mentionedIds.map((mentionedUserId) => ({
              clipId,
              mentionedUserId,
            })),
          )
        }
        if (tags.length > 0) {
          await tx.insert(clipTag).values(tags.map((tag) => ({ clipId, tag })))
        }
        // Drop the staging row WITHOUT touching storage — the clip now owns
        // the same source/thumb objects.
        await tx.delete(stagingRecording).where(eq(stagingRecording.id, id))
      })

      void publishClipUpsert(viewerId, clipId)
      void prewarmPublishedHls(clipId)
      if (body.privacy === "public") {
        void notifyFollowersOfNewClip({ authorId: viewerId, clipId })
      }

      return c.json({ clipId })
    },
  )
  .delete(
    "/:id",
    requireSession,
    zValidator("param", StagingIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const access = await selectStagingForOwner(c, { id, viewerId })
      if ("response" in access) return access.response
      const row = access.row

      await cancelStagingMediaProcessing(id)
      await db.delete(stagingRecording).where(eq(stagingRecording.id, id))

      for (const key of [row.sourceKey, row.thumbKey]) {
        if (!key) continue
        try {
          await clipStorage.delete(key)
        } catch (err) {
          logger.warn(`failed to delete staging asset ${key}:`, err)
        }
      }
      await cleanupTickets(
        { type: "staging", id },
        `staging ${id} staged upload`,
      )
      return deleted(c)
    },
  )
  .get(
    "/:id/stream",
    requireSession,
    zValidator("param", StagingIdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const access = await selectStagingForOwner(c, { id, viewerId })
      if ("response" in access) return access.response
      const row = access.row
      if (!row.sourceKey || !row.sourceContentType) {
        return notFound(c, "Stream unavailable")
      }

      const direct = await redirectToStorageUrl(
        c,
        clipStorage,
        { key: row.sourceKey, contentType: row.sourceContentType || undefined },
        STAGING_CACHE_CONTROL,
      )
      if (direct) return direct

      const resolved = await clipStorage.resolve(row.sourceKey)
      if (!resolved) return notFound(c, "Stream unavailable")
      return streamResolved(
        c,
        resolved,
        row.sourceContentType || resolved.contentType,
        STAGING_CACHE_CONTROL,
      )
    },
  )
  .get(
    "/:id/thumbnail",
    requireSession,
    zValidator("param", StagingIdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const access = await selectStagingForOwner(c, { id, viewerId })
      if ("response" in access) return access.response
      const row = access.row
      if (!row.thumbKey) return notFound(c, "No thumbnail")

      const direct = await redirectToStorageUrl(
        c,
        clipStorage,
        { key: row.thumbKey },
        STAGING_CACHE_CONTROL,
      )
      if (direct) return direct
      return streamThumbnail(c, row.thumbKey, STAGING_CACHE_CONTROL)
    },
  )

async function prewarmPublishedHls(clipId: string): Promise<void> {
  try {
    const [fresh] = await db
      .select({
        id: clip.id,
        sourceKey: clip.sourceKey,
        sourceSizeBytes: clip.sourceSizeBytes,
        updatedAt: clip.updatedAt,
      })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    if (!fresh?.sourceKey) return
    await ensureDirectHlsPackage(
      makeDirectHlsSpec({ ...fresh, sourceKey: fresh.sourceKey }),
    )
  } catch (err) {
    logger.warn(`HLS prewarm failed for published clip ${clipId}:`, err)
  }
}
