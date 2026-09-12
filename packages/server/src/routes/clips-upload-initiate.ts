import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { resolveTrimRange } from "@alloy/server/clips/trim-range"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { getGameRefById } from "@alloy/server/games/ref"
import { conflict, badRequest } from "@alloy/server/runtime/http-response"
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletion } from "@alloy/server/storage/deletion-store"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { uploadTicketDeadline } from "@alloy/server/uploads/deadline"
import { commitUploadInitiateAndWake } from "@alloy/server/uploads/expiry"
import {
  mintStagedUpload,
  stagedSourceKey,
  uploadTicketForRequestOrigin,
} from "@alloy/server/uploads/staged"
import { createUploadTickets } from "@alloy/server/uploads/tickets"
import { accountDeletionState } from "@alloy/server/users/account-deletion-state"
import { type Context, Hono } from "hono"
import type { StaticDecode } from "typebox"

import { InitiateBody } from "./clips-helpers"
import {
  resolveMentionIds,
  selectLockedQuotaState,
  type UploadQuotaResult,
  uploadQuotaExceededResponse,
  uploadQuotaResult,
} from "./clips-upload-helpers"
import { tbValidator } from "./validation"

const logger = createLogger("clips")
type InitiateBodyInput = StaticDecode<typeof InitiateBody>
type InitiateDetails = {
  privacy: InitiateBodyInput["privacy"]
  trim: ReturnType<typeof resolveTrimRange> | null
  gameRef: Awaited<ReturnType<typeof getGameRefById>>
  mentionedIds: string[]
}
type InitiateTransactionResult =
  | UploadQuotaResult
  | {
      ok: false
      reason: "id-conflict"
    }

async function cleanupFailedInitiate(
  clipId: string,
  uploadKey: string,
): Promise<void> {
  try {
    await enqueueStorageDeletion(
      stagedUploadDeletionIntent({
        key: uploadKey,
        reason: "clip initiation failed",
        source: { type: "clip-initiate", id: clipId },
      }),
    )
  } catch (err) {
    logger.warn(
      `failed to compensate upload key for clip ${clipId} after initiate failure:`,
      err,
    )
  }
}

async function resolveInitiateDetails(
  c: Context,
  body: InitiateBodyInput,
  viewerId: string,
): Promise<InitiateDetails | { response: Response }> {
  const trim =
    body.trimStartMs !== undefined &&
    body.trimEndMs !== undefined &&
    body.durationMs !== undefined
      ? resolveTrimRange({
          startMs: body.trimStartMs,
          endMs: body.trimEndMs,
          durationMs: body.durationMs,
        })
      : null
  const gameRef =
    body.gameId === undefined || body.gameId === null
      ? null
      : await getGameRefById(body.gameId)
  if (body.gameId !== undefined && body.gameId !== null && !gameRef) {
    return { response: badRequest(c, "Unknown game") }
  }
  return {
    privacy: body.privacy ?? "public",
    trim,
    gameRef,
    mentionedIds: body.mentionedUserIds
      ? await resolveMentionIds(body.mentionedUserIds, viewerId)
      : [],
  }
}

async function mintInitiateUpload(input: {
  clipId: string
  uploadKey: string
  viewerId: string
  body: InitiateBodyInput
}): Promise<Awaited<ReturnType<typeof mintStagedUpload>>> {
  try {
    return await mintStagedUpload({
      key: input.uploadKey,
      contentType: input.body.contentType,
      maxBytes: input.body.sizeBytes,
      expiresInSec: configStore.get("limits").uploadTtlSec,
      userId: input.viewerId,
      clipId: input.clipId,
    })
  } catch (err) {
    await cleanupFailedInitiate(input.clipId, input.uploadKey)
    throw err
  }
}

async function insertInitiatedClip(
  tx: DbTransaction,
  input: {
    clipId: string
    viewerId: string
    body: InitiateBodyInput
    details: InitiateDetails
    expiresAt: Date
  },
): Promise<boolean> {
  const { body, clipId, details, expiresAt, viewerId } = input
  const [inserted] = await tx
    .insert(clip)
    .values({
      id: clipId,
      media_kind: body.contentType.startsWith("image/") ? "image" : "video",
      author_id: viewerId,
      title: body.title,
      description: body.description ?? null,
      game: details.gameRef?.name ?? null,
      game_id: details.gameRef?.id ?? null,
      privacy: details.privacy,
      source_content_type: body.contentType,
      source_size_bytes: body.sizeBytes,
      // Client-probed hints keep placeholders' media shape while processing.
      width: body.width ?? null,
      height: body.height ?? null,
      duration_ms: body.durationMs ?? null,
      // The media run applies this source range when it derives the cut.
      trim_start_ms: details.trim
        ? details.trim.kind === "range"
          ? details.trim.startMs
          : null
        : (body.trimStartMs ?? null),
      trim_end_ms: details.trim
        ? details.trim.kind === "range"
          ? details.trim.endMs
          : null
        : (body.trimEndMs ?? null),
      status: "pending",
      upload_cleanup_at: expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: clip.id })
  return Boolean(inserted)
}

async function insertInitiateMetadata(
  tx: DbTransaction,
  clipId: string,
  body: InitiateBodyInput,
  mentionedIds: string[],
): Promise<void> {
  if (mentionedIds.length > 0) {
    await tx.insert(clipMention).values(
      mentionedIds.map((mentionedUserId) => ({
        clip_id: clipId,
        mentioned_user_id: mentionedUserId,
      })),
    )
  }
  const tags = body.tags ? normalizeTags(body.tags) : []
  if (tags.length > 0) {
    await tx
      .insert(clipTag)
      .values(tags.map((tag) => ({ clip_id: clipId, tag })))
  }
}

async function persistInitiate(input: {
  clipId: string
  viewerId: string
  body: InitiateBodyInput
  details: InitiateDetails
  uploadKey: string
  expiresAt: Date
}): Promise<InitiateTransactionResult> {
  return commitUploadInitiateAndWake(() =>
    db.transaction<InitiateTransactionResult>(async (tx) => {
      const { quotaBytes, usedBytes } = await selectLockedQuotaState(
        tx,
        input.viewerId,
      )
      const quota = uploadQuotaResult({
        quotaBytes,
        usedBytes,
        incomingBytes: input.body.sizeBytes,
      })
      if (!quota.ok) return quota
      if (
        !(await insertInitiatedClip(tx, {
          clipId: input.clipId,
          viewerId: input.viewerId,
          body: input.body,
          details: input.details,
          expiresAt: input.expiresAt,
        }))
      ) {
        return { ok: false, reason: "id-conflict" }
      }
      await insertInitiateMetadata(
        tx,
        input.clipId,
        input.body,
        input.details.mentionedIds,
      )
      await createUploadTickets(
        {
          target: { type: "clip", id: input.clipId },
          ownerId: input.viewerId,
          videoKey: input.uploadKey,
          videoContentType: input.body.contentType,
          videoBytes: input.body.sizeBytes,
          expiresAt: input.expiresAt,
        },
        { tx },
      )
      return { ok: true }
    }),
  )
}

async function initiateClipUpload(
  c: Context,
  viewerId: string,
  body: InitiateBodyInput,
  clipId: string,
  uploadKey: string,
) {
  return withUploadActivityStopped(clipId, async () => {
    const details = await resolveInitiateDetails(c, body, viewerId)
    if ("response" in details) return details.response
    const videoUpload = await mintInitiateUpload({
      clipId,
      uploadKey,
      viewerId,
      body,
    })
    const expiresAt = uploadTicketDeadline(videoUpload.expiresAt)
    let result: InitiateTransactionResult
    try {
      result = await persistInitiate({
        clipId,
        viewerId,
        body,
        details,
        uploadKey,
        expiresAt,
      })
    } catch (err) {
      await cleanupFailedInitiate(clipId, uploadKey)
      throw err
    }
    if (!result.ok) {
      await cleanupFailedInitiate(clipId, uploadKey)
      if ("reason" in result) return conflict(c, "Clip upload already exists")
      return uploadQuotaExceededResponse(c, result)
    }
    void publishClipUpsert(viewerId, clipId)
    return c.json({
      clipId,
      ticket: uploadTicketForRequestOrigin(videoUpload, c.req.url),
    })
  })
}

export const clipsUploadInitiateRoutes = new Hono().post(
  "/initiate",
  requireSession,
  tbValidator("json", InitiateBody),
  async (c) => {
    const viewerId = c.var.viewerId
    const body = c.req.valid("json")
    const clipId = (body.clientClipId ?? crypto.randomUUID()).toLowerCase()
    const uploadKey = stagedSourceKey(
      clipId,
      body.contentType,
      crypto.randomUUID(),
    )
    const initiated = await accountDeletionState.withInactive(viewerId, () =>
      initiateClipUpload(c, viewerId, body, clipId, uploadKey),
    )
    if (!initiated.ok) {
      return conflict(c, "Account deletion is in progress")
    }
    return initiated.value
  },
)
