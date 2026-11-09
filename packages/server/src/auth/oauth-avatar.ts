import { user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { userAssetDeletionIntents } from "@alloy/server/users/user-asset-deletion"
import { eq } from "drizzle-orm"

import type { OAuthProfile } from "./oauth-types"

const logger = createLogger("oauth")

/**
 * Point the user's avatar at the provider's picture URL. Browsers load it
 * from the provider, so the server never fetches the URL and keeps no copy.
 */
export async function syncOAuthAvatar(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  // No claim leaves the current avatar alone: a provider that stops sending
  // one hands the avatar back to the user rather than wiping it.
  const avatarUrl = profile.avatarUrl
  if (!avatarUrl) return

  try {
    const queuedDeletions = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ image: user.image })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
        .for("update")
      if (!row || row.image === avatarUrl) return 0

      await tx
        .update(user)
        .set({ image: avatarUrl, updated_at: new Date() })
        .where(eq(user.id, userId))
      // An avatar uploaded before the account was linked is now unreferenced.
      const displaced = userAssetDeletionIntents({
        userId,
        role: "avatar",
        previousUrl: row.image,
        reason: "avatar replaced by OAuth provider",
        source: { type: "user-asset", id: userId },
      })
      await enqueueStorageDeletions(displaced, { tx })
      return displaced.length
    })
    if (queuedDeletions > 0) wakeStorageDeletionWorker()
  } catch (cause) {
    logger.warn(`avatar sync failed for user ${userId}:`, cause)
  }
}
