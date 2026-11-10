import { createAdminConfigApi } from "./admin-config"
import { createAdminResourcesApi } from "./admin-resources"
import type { ApiContext } from "./client"
export {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OIDC_CALLBACK_PATH,
} from "@alloy/contracts"
export type {
  AdminGameRow,
  AdminAuthConfigPatch,
  AdminOidcConfig,
  AdminOidcConfigPatch,
  AdminRuntimeConfig,
  AdminUpdateGameInput,
  AdminUserStorageRow,
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
  GameAssetRole,
  HardwareAcceleration,
  RenditionTierConfig,
  SteamGridDBAsset,
  TranscodingCapabilities,
  OAuthTokenAuthMethod,
  VideoCodec,
} from "@alloy/contracts"
export {
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/contracts"

export function createAdminApi(context: ApiContext) {
  return {
    ...createAdminConfigApi(context),
    ...createAdminResourcesApi(context),
  }
}
