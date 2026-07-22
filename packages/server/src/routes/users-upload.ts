import { requireSession } from "@alloy/server/auth/require-session"
import { errorResult } from "@alloy/server/runtime/http-response"
import type { UserAssetRole } from "@alloy/server/storage/driver"
import { userStorage } from "@alloy/server/storage/index"
import {
  EXT_FOR_CONTENT_TYPE,
  removeUserAsset,
  uploadUserAsset,
  USER_ASSET_LIMITS,
  type UserAssetUpdateResult,
} from "@alloy/server/users/user-assets"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

import { immutableImageAssetsRoute } from "./immutable-image-assets"
import { zValidator } from "./validation"

const UserAssetUploadForm = z.object({
  file: z.instanceof(File, { message: "Expected an uploaded image file" }),
})

const USER_ASSET_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:avatar|banner)\.webp$/i

function validateUserAssetFile(
  role: UserAssetRole,
  file: File,
): UserAssetUpdateResult | null {
  const limit = USER_ASSET_LIMITS[role]
  if (file.size === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (file.size > limit.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${limit.label} too large. Max ${limit.maxBytes / 1024 / 1024} MB`,
    }
  }
  if (!Object.hasOwn(EXT_FOR_CONTENT_TYPE, file.type)) {
    return { ok: false, status: 400, error: "Unsupported image type" }
  }
  return null
}

async function uploadUserAssetResponse(
  viewerId: string,
  role: UserAssetRole,
  file: File,
) {
  const invalid = validateUserAssetFile(role, file)
  if (invalid) return invalid

  const bytes = new Uint8Array(await file.arrayBuffer())
  return uploadUserAsset({
    userId: viewerId,
    role,
    bytes,
    contentType: file.type,
  })
}

type UserAssetMutation<U> =
  | { ok: true; user: U }
  | { ok: false; error: string; status: ContentfulStatusCode }

async function respondUserAsset<U>(
  c: Context,
  pending: Promise<UserAssetMutation<U>>,
) {
  const result = await pending
  return result.ok ? c.json(result.user) : errorResult(c, result)
}

// Both asset upload routes share the same shape; only the role differs.
function uploadUserAssetHandler(role: UserAssetRole) {
  return (
    c: Context<
      { Variables: { viewerId: string } },
      string,
      { out: { form: z.infer<typeof UserAssetUploadForm> } }
    >,
  ) =>
    respondUserAsset(
      c,
      uploadUserAssetResponse(c.var.viewerId, role, c.req.valid("form").file),
    )
}

export const usersUploadRoute = new Hono<{
  Variables: { viewerId: string }
}>()
  .post(
    "/me/avatar/upload",
    requireSession,
    zValidator("form", UserAssetUploadForm),
    uploadUserAssetHandler("avatar"),
  )
  .post(
    "/me/banner/upload",
    requireSession,
    zValidator("form", UserAssetUploadForm),
    uploadUserAssetHandler("banner"),
  )
  .delete("/me/avatar", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "avatar")),
  )
  .delete("/me/banner", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "banner")),
  )

export const userAssetsRoute = immutableImageAssetsRoute(
  userStorage,
  USER_ASSET_KEY_RE,
)
