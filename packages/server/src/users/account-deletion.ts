import { randomUUID } from "node:crypto"

import { user } from "@alloy/db/auth-schema"
import { clip, clipView } from "@alloy/db/schema"
import type { AccountDisableSource } from "@alloy/server/auth/account-state"
import { disableUserIdentity } from "@alloy/server/auth/identity"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { db } from "@alloy/server/db/index"
import { postgresErrorHasCode } from "@alloy/server/db/postgres-error"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { and, eq } from "drizzle-orm"

import { accountDeletionState } from "./account-deletion-state"
import { userAssetDeletionIntents } from "./user-asset-deletion"

const FINAL_TRANSACTION_DEADLOCK_RETRIES = 4

export type AccountDeletionResult = "deleted" | "not-found"

type FinalTransactionResult =
  | { kind: "not-found" }
  | { kind: "retry-clips" }
  | {
      kind: "deleted"
      queuedDeletions: number
    }

export function deleteUserAccount(
  userId: string,
  source: AccountDisableSource,
): Promise<AccountDeletionResult> {
  return accountDeletionState.run(userId, () =>
    runAccountDeletion(userId, source),
  )
}

async function runAccountDeletion(
  userId: string,
  source: AccountDisableSource,
): Promise<AccountDeletionResult> {
  // This is the short, monotonic access-removing transition. Sessions remain
  // so a self-delete can retry through requireAnySession after a crash.
  const disabled = await disableUserIdentity(userId, source)
  if (!disabled) return "not-found"

  while (true) {
    const authoredClip = await selectAuthoredClip(userId)
    if (authoredClip) {
      // Media/upload gates may wait. Never hold the user row transaction while
      // draining them. Deleting a clip removes its upload ticket with it, and
      // every ticket belongs to one of its owner's clips, so no ticket is left
      // once the clips are gone.
      await deleteClipRowAndAssets(authoredClip)
      continue
    }

    const finalized = await finalizeWithDeadlockRetry(userId)
    if (finalized.kind === "retry-clips") continue
    if (finalized.kind === "not-found") return "not-found"

    if (finalized.queuedDeletions > 0) wakeStorageDeletionWorker()
    return "deleted"
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

async function finalizeWithDeadlockRetry(
  userId: string,
): Promise<FinalTransactionResult> {
  return retryPostgresDeadlocks(
    () => db.transaction((tx) => finalizeAccountDeletion(tx, userId)),
    FINAL_TRANSACTION_DEADLOCK_RETRIES,
  )
}

async function finalizeAccountDeletion(
  tx: DbTransaction,
  userId: string,
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

  const [deletedUser] = await tx
    .delete(user)
    .where(eq(user.id, userId))
    .returning({ id: user.id })
  if (!deletedUser) throw new Error("Locked user could not be deleted")

  return { kind: "deleted", queuedDeletions: assetIntents.length }
}

async function retryPostgresDeadlocks<T>(
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
