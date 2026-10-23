import { t } from "@alloy/contracts/schema"
import { requireSession } from "@alloy/server/auth/session"
import { errorResult } from "@alloy/server/runtime/http-response"
import type { UserAssetRole } from "@alloy/server/storage/driver"
import { assetStorage } from "@alloy/server/storage/index"
import { imageBodyLimit } from "@alloy/server/uploads/image-body-limit"
import { USER_ASSET_ROUTE_KEY_RE } from "@alloy/server/users/user-asset-deletion"
import {
  removeUserAsset,
  uploadUserAsset,
  userAssetLimit,
} from "@alloy/server/users/user-assets"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { imageFileError } from "./image-upload"
import { immutableImageAssetsRoute } from "./immutable-image-assets"
import { tbValidator } from "./validation"

const UserAssetUploadForm = t.object({
  file: t.instanceof(File, { message: "Expected an uploaded image file" }),
})

async function uploadUserAssetResponse(
  viewerId: string,
  role: UserAssetRole,
  file: File,
) {
  const invalid = imageFileError(file, userAssetLimit(role))
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
      { out: { form: t.infer<typeof UserAssetUploadForm> } }
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
    imageBodyLimit("avatarMaxBytes"),
    tbValidator("form", UserAssetUploadForm),
    uploadUserAssetHandler("avatar"),
  )
  .post(
    "/me/banner/upload",
    requireSession,
    imageBodyLimit("bannerMaxBytes"),
    tbValidator("form", UserAssetUploadForm),
    uploadUserAssetHandler("banner"),
  )
  .delete("/me/avatar", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "avatar")),
  )
  .delete("/me/banner", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "banner")),
  )

export const userAssetsRoute = immutableImageAssetsRoute(
  assetStorage,
  USER_ASSET_ROUTE_KEY_RE,
)
