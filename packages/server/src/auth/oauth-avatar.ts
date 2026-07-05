import { user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { env } from "@alloy/server/env"
import { parseImageBytes } from "@alloy/server/media/image-validation"
import {
  fetchRemoteImage,
  resolvesToPublicAddress,
} from "@alloy/server/media/remote-image"
import { uploadUserAsset } from "@alloy/server/users/user-assets"
import { eq } from "drizzle-orm"

import type { OAuthProfile } from "./oauth-types"

const logger = createLogger("oauth")

export async function syncOAuthAvatar(
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  if (!profile.avatarUrl) return

  try {
    const [row] = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!row || row.image?.trim()) return

    // The avatar URL is an IdP claim end users can influence on permissive
    // IdPs; refuse non-public hosts and redirects so this server-side fetch
    // cannot reach internal services. LAN IdPs opt back in via env.
    const allowPrivate = env.oauthAvatarAllowPrivateUrls
    if (!allowPrivate && !(await resolvesToPublicAddress(profile.avatarUrl))) {
      logger.warn(
        `skipped OAuth avatar for user ${userId}: URL resolves to a non-public address`,
      )
      return
    }

    const { bytes } = await fetchRemoteImage(
      profile.avatarUrl,
      "oauth avatar",
      undefined,
      { redirect: allowPrivate ? "follow" : "error" },
    )
    const parsed = parseImageBytes(bytes)
    if (!parsed) {
      logger.warn(`skipped unsupported OAuth avatar for user ${userId}`)
      return
    }

    const result = await uploadUserAsset({
      userId,
      role: "avatar",
      bytes,
      contentType: parsed.contentType,
    })
    if (!result.ok) {
      logger.warn(
        `OAuth avatar upload failed for user ${userId}: ${result.error}`,
      )
    }
  } catch (cause) {
    logger.warn(`avatar sync failed for user ${userId}:`, cause)
  }
}
