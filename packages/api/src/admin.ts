import { createAdminConfigApi } from "./admin-config"
import { createAdminResourcesApi } from "./admin-resources"
import type { ApiContext } from "./client"
export {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_USERNAME_CLAIM_DEFAULT,
  publicOAuthProviderIconUrl,
} from "@alloy/contracts"
export type {
  AdminCreateGameInput,
  AdminGameRow,
  AdminLimitsConfig,
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminStorageConfig,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
  AdminWebhookTestResult,
  AppearanceConfig,
  GameAssetRole,
  HardwareAcceleration,
  RenditionTierConfig,
  RuntimeConfig,
  SteamGridDBAsset,
  SteamGridDBArtworkResponse,
  TranscodingCapabilities,
  TranscodingConfig,
  TranscodingEncoderProbe,
  OAuthTokenAuthMethod,
  UsernameClaim,
  VideoCodec,
} from "@alloy/contracts"
export {
  DEFAULT_RENDITION_TIERS,
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/contracts"

export function createAdminApi(context: ApiContext) {
  return {
    ...createAdminConfigApi(context),
    ...createAdminResourcesApi(context),
  }
}
