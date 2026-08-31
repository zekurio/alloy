import { randomUUID } from "node:crypto"

import { t } from "@alloy/contracts/schema"
import { authChallenge, user } from "@alloy/db/auth-schema"
import {
  clip,
  clipComment,
  clipCommentLike,
  clipLike,
  clipView,
  uploadTicket,
} from "@alloy/db/schema"
import {
  disableUserIdentity,
  type AuthTransaction,
} from "@alloy/server/auth/identity"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { publishClipUpsertById } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteOwnedUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { and, eq, inArray, or, sql } from "drizzle-orm"

import { accountDeletionState } from "./account-deletion-state"
import { userAssetDeletionIntents } from "./user-asset-deletion"

const FINAL_TRANSACTION_DEADLOCK_RETRIES = 4
const PostgreSqlErrorSchema = t.object({
  cause: t.unknown().optional(),
  code: t.string().optional(),
})

export type AccountDeletionResult = "deleted" | "not-found"

type FinalTransactionResult =
  | { kind: "not-found" }
  | { kind: "retry-clips" }
  | {
      kind: "deleted"
      affectedClipIds: string[]
      queuedDeletions: number
    }

class UngatedUploadTargetError extends Error {}

export function deleteUserAccount(
  userId: string,
): Promise<AccountDeletionResult> {
  return accountDeletionState.run(userId, () => runAccountDeletion(userId))
}

export async function withCanonicalUploadTargetsStopped<T>(
  targetIds: readonly string[],
  operation: () => Promise<T>,
  stop: typeof withUploadActivityStopped = withUploadActivityStopped,
): Promise<T> {
  const canonical = canonicalIds(targetIds)
  const acquire = (index: number): Promise<T> => {
    const targetId = canonical[index]
    return targetId ? stop(targetId, () => acquire(index + 1)) : operation()
  }
  return acquire(0)
}

async function runAccountDeletion(
  userId: string,
): Promise<AccountDeletionResult> {
  // This is the short, monotonic access-removing transition. Sessions remain
  // so a self-delete can retry through requireAnySession after a crash.
  const disabled = await disableUserIdentity(userId)
  if (!disabled) return "not-found"

  while (true) {
    const authoredClip = await selectAuthoredClip(userId)
    if (authoredClip) {
      // Media/upload gates may wait. Never hold the user row transaction while
      // draining them.
      await deleteClipRowAndAssets(authoredClip)
      continue
    }

    const gatedTargetIds = await selectOwnedUploadTargetIds(userId)
    try {
      const finalized = await withCanonicalUploadTargetsStopped(
        gatedTargetIds,
        () =>
          finalizeWithDeadlockRetry(
            userId,
            new Set(canonicalIds(gatedTargetIds)),
          ),
      )
      if (finalized.kind === "retry-clips") continue
      if (finalized.kind === "not-found") return "not-found"

      if (finalized.queuedDeletions > 0) wakeStorageDeletionWorker()
      for (const clipId of finalized.affectedClipIds) {
        void publishClipUpsertById(clipId)
      }
      return "deleted"
    } catch (cause) {
      if (cause instanceof UngatedUploadTargetError) continue
      throw cause
    }
  }
}

async function selectAuthoredClip(userId: string) {
  const [row] = await db
    .select()
    .from(clip)
    .where(eq(clip.author_id, userId))
    .orderBy(clip.id)
    .limit(1)
  return row ?? null
}

async function selectOwnedUploadTargetIds(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ targetId: uploadTicket.target_id })
    .from(uploadTicket)
    .where(eq(uploadTicket.owner_id, userId))
  return canonicalIds(rows.map((row) => row.targetId))
}

async function finalizeWithDeadlockRetry(
  userId: string,
  gatedTargetIds: ReadonlySet<string>,
): Promise<FinalTransactionResult> {
  return retryPostgresDeadlocks(
    () =>
      db.transaction((tx) =>
        finalizeAccountDeletion(tx, userId, gatedTargetIds),
      ),
    FINAL_TRANSACTION_DEADLOCK_RETRIES,
  )
}

async function finalizeAccountDeletion(
  tx: AuthTransaction,
  userId: string,
  gatedTargetIds: ReadonlySet<string>,
): Promise<FinalTransactionResult> {
  const [lockedUser] = await tx
    .select({
      id: user.id,
      image: user.image,
      banner: user.banner,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .for("update")
  if (!lockedUser) return { kind: "not-found" }

  // The row lock fences every new child FK writer. A clip that committed just
  // before the lock is drained outside this transaction on the next pass.
  const [remainingClip] = await tx
    .select({ id: clip.id })
    .from(clip)
    .where(eq(clip.author_id, userId))
    .limit(1)
  if (remainingClip) return { kind: "retry-clips" }

  const currentTicketTargets = await tx
    .selectDistinct({ targetId: uploadTicket.target_id })
    .from(uploadTicket)
    .where(eq(uploadTicket.owner_id, userId))
  if (
    canonicalIds(currentTicketTargets.map((row) => row.targetId)).some(
      (targetId) => !gatedTargetIds.has(targetId),
    )
  ) {
    // Throw rather than return so no future mutation added above this check
    // can accidentally commit before the larger stable gate set is retried.
    throw new UngatedUploadTargetError()
  }

  const descendantClipIds = await selectAuthoredCommentTreeClipIds(tx, userId)
  const assetIntents = [
    ...userAssetDeletionIntents({
      userId,
      role: "avatar",
      previousUrl: lockedUser.image,
      reason: "account avatar deleted",
      source: { type: "account-deletion", id: userId },
    }),
    ...userAssetDeletionIntents({
      userId,
      role: "banner",
      previousUrl: lockedUser.banner,
      reason: "account banner deleted",
      source: { type: "account-deletion", id: userId },
    }),
  ]
  await enqueueStorageDeletions(assetIntents, { tx })
  const stagedIntentCount = await deleteOwnedUploadTicketsWithStorageIntents(
    userId,
    `account ${userId} deleted`,
    tx,
  )

  const deletedLikes = await tx
    .delete(clipLike)
    .where(eq(clipLike.user_id, userId))
    .returning({ clipId: clipLike.clip_id })
  const deletedCommentLikes = await tx
    .delete(clipCommentLike)
    .where(eq(clipCommentLike.user_id, userId))
    .returning({ commentId: clipCommentLike.comment_id })
  const deletedComments = await tx
    .delete(clipComment)
    .where(eq(clipComment.author_id, userId))
    .returning({ id: clipComment.id, clipId: clipComment.clip_id })

  const viewRows = await tx
    .select({ clipId: clipView.clip_id, viewerKey: clipView.viewer_key })
    .from(clipView)
    .where(eq(clipView.user_id, userId))
    .orderBy(clipView.clip_id, clipView.viewer_key)
  for (const row of viewRows) {
    await tx
      .update(clipView)
      .set({ user_id: null, viewer_key: `deleted:${randomUUID()}` })
      .where(
        and(
          eq(clipView.clip_id, row.clipId),
          eq(clipView.viewer_key, row.viewerKey),
          eq(clipView.user_id, userId),
        ),
      )
  }

  // The FK owns new challenge rows. These predicates retire legacy rows made
  // before user_id existed while avoiding discoverable/sign-up challenges.
  await tx.delete(authChallenge).where(
    or(
      eq(authChallenge.user_id, userId),
      sql`lower(coalesce(${authChallenge.payload}->>'userId', '')) = lower(${userId})`,
      and(
        eq(authChallenge.purpose, "passkey-registration"),
        sql`lower(${authChallenge.identifier}) = lower(${userId})`,
        // A sign-up challenge uses username as its identifier. Existing-user
        // registration never carries the username payload field.
        sql`not (${authChallenge.payload} ? 'username')`,
      ),
    ),
  )

  const [deletedUser] = await tx
    .delete(user)
    .where(eq(user.id, userId))
    .returning({ id: user.id })
  if (!deletedUser) throw new Error("Locked user could not be deleted")

  const { affectedCommentIds, affectedClipIds } =
    accountDeletionCounterRepairPlan({
      authoredCommentClipIds: [
        ...descendantClipIds,
        ...deletedComments.map((row) => row.clipId),
      ],
      likedClipIds: deletedLikes.map((row) => row.clipId),
      likedCommentIds: deletedCommentLikes.map((row) => row.commentId),
    })

  // Existing engagement writes lock child rows before their cached parent.
  // Follow that order, lock parents canonically, then recompute in subsequent
  // statements so READ COMMITTED snapshots include writers we waited for.
  if (affectedCommentIds.length > 0) {
    await tx
      .select({ id: clipComment.id })
      .from(clipComment)
      .where(inArray(clipComment.id, affectedCommentIds))
      .orderBy(clipComment.id)
      .for("update")
  }
  if (affectedClipIds.length > 0) {
    await tx
      .select({ id: clip.id })
      .from(clip)
      .where(inArray(clip.id, affectedClipIds))
      .orderBy(clip.id)
      .for("update")
  }
  if (affectedCommentIds.length > 0) {
    await tx
      .update(clipComment)
      .set({
        like_count: sql<number>`(
          select count(*)::int
          from ${clipCommentLike}
          where ${clipCommentLike.comment_id} = ${clipComment.id}
        )`,
      })
      .where(inArray(clipComment.id, affectedCommentIds))
  }
  if (affectedClipIds.length > 0) {
    await tx
      .update(clip)
      .set({
        like_count: sql<number>`(
          select count(*)::int
          from ${clipLike}
          where ${clipLike.clip_id} = ${clip.id}
        )`,
        comment_count: sql<number>`(
          select count(*)::int
          from ${clipComment}
          where ${clipComment.clip_id} = ${clip.id}
        )`,
      })
      .where(inArray(clip.id, affectedClipIds))
  }

  return {
    kind: "deleted",
    affectedClipIds,
    queuedDeletions: assetIntents.length + stagedIntentCount,
  }
}

async function selectAuthoredCommentTreeClipIds(
  tx: AuthTransaction,
  userId: string,
): Promise<string[]> {
  const result = await tx.execute<{ clipId: string }>(sql`
    with recursive account_comment_tree as (
      select ${clipComment.id} as id, ${clipComment.clip_id} as clip_id
      from ${clipComment}
      where ${clipComment.author_id} = ${userId}
      union
      select child.id, child.clip_id
      from ${clipComment} as child
      inner join account_comment_tree as parent
        on child.parent_id = parent.id
    )
    select distinct clip_id as "clipId"
    from account_comment_tree
  `)
  return canonicalIds(result.rows.map((row) => row.clipId))
}

export function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort()
}

export function accountDeletionCounterRepairPlan(input: {
  authoredCommentClipIds: readonly string[]
  likedClipIds: readonly string[]
  likedCommentIds: readonly string[]
}): AccountDeletionCounterRepairPlan {
  return {
    affectedClipIds: canonicalIds([
      ...input.authoredCommentClipIds,
      ...input.likedClipIds,
    ]),
    affectedCommentIds: canonicalIds(input.likedCommentIds),
  }
}

export interface AccountDeletionCounterRepairPlan {
  affectedClipIds: string[]
  affectedCommentIds: string[]
}

export function postgresErrorHasCode(
  cause: unknown,
  expectedCode: string,
): boolean {
  let current = cause
  for (let depth = 0; depth < 4; depth += 1) {
    const parsed = PostgreSqlErrorSchema.safeParse(current)
    if (!parsed.success) return false
    if (parsed.data.code === expectedCode) return true
    current = parsed.data.cause
  }
  return false
}

export async function retryPostgresDeadlocks<T>(
  operation: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (cause) {
      if (!postgresErrorHasCode(cause, "40P01") || attempt >= maxRetries) {
        throw cause
      }
    }
  }
}
