import type {
  AdminAuthConfigPatch,
  AdminCreateGameInput,
  AdminOAuthProviderInput,
  AdminSweepKind,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminWebhookInput,
  AdminWebhookPatch,
  GameAssetRole,
} from "@alloy/contracts"

import type {
  AppearanceConfigPatch,
  RuntimeConfigPatch,
  TranscodingConfigPatch,
} from "./admin-config"
import {
  fetchRuntimeConfig,
  fetchTranscodingCapabilities,
  updateAppearanceConfig,
  updateAuthConfig,
  updateOAuthProviders,
  updateRuntimeConfig,
  updateTranscodingConfig,
} from "./admin-config"
import {
  discardJob,
  fetchFailedJobs,
  fetchJobsSummary,
  reEncodeAllClips,
  retryJob,
  runJobSweep,
  setJobKindPaused,
} from "./admin-jobs"
import type { AdminCreateUserInput } from "./admin-resources"
import {
  createGame,
  createUser,
  createWebhook,
  deleteGame,
  deleteGameAsset,
  deleteUser,
  deleteWebhook,
  fetchGames,
  fetchUsers,
  fetchWebhooks,
  testWebhook,
  updateGame,
  updateUser,
  updateWebhook,
  uploadGameAsset,
} from "./admin-resources"
import type { ApiContext } from "./client"
export {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_TOKEN_AUTH_METHODS,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/contracts"
export type {
  AdminCreateGameInput,
  AdminFailedJob,
  AdminFailedJobsPage,
  AdminGameRow,
  AdminIntegrationsConfig,
  AdminJobKindRow,
  AdminJobsSummary,
  AdminJobsSweeps,
  AdminRenditionSweepSummary,
  AdminStorageGcSummary,
  AdminStorageVerifySummary,
  AdminSweepKind,
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
    fetchRuntimeConfig: () => fetchRuntimeConfig(context),
    updateRuntimeConfig: (input: RuntimeConfigPatch) =>
      updateRuntimeConfig(context, input),
    updateAppearanceConfig: (patch: AppearanceConfigPatch) =>
      updateAppearanceConfig(context, patch),
    updateTranscodingConfig: (patch: TranscodingConfigPatch) =>
      updateTranscodingConfig(context, patch),
    updateAuthConfig: (patch: AdminAuthConfigPatch) =>
      updateAuthConfig(context, patch),
    updateOAuthProviders: (providers: AdminOAuthProviderInput[]) =>
      updateOAuthProviders(context, providers),
    fetchTranscodingCapabilities: (options?: { refresh?: boolean }) =>
      fetchTranscodingCapabilities(context, options),
    reEncodeAllClips: () => reEncodeAllClips(context),
    fetchJobsSummary: () => fetchJobsSummary(context),
    fetchFailedJobs: (options?: {
      kind?: string
      cursor?: string
      limit?: number
    }) => fetchFailedJobs(context, options),
    retryJob: (jobId: string) => retryJob(context, jobId),
    discardJob: (jobId: string) => discardJob(context, jobId),
    runJobSweep: (kind: AdminSweepKind, mode?: "stale" | "force") =>
      runJobSweep(context, kind, mode),
    setJobKindPaused: (kind: string, paused: boolean) =>
      setJobKindPaused(context, kind, paused),
    fetchUsers: (options?: {
      cursor?: string
      limit?: number
      search?: string
    }) => fetchUsers(context, options),
    createUser: (input: AdminCreateUserInput) => createUser(context, input),
    updateUser: (userId: string, input: AdminUpdateUserInput) =>
      updateUser(context, userId, input),
    deleteUser: (userId: string) => deleteUser(context, userId),
    fetchGames: () => fetchGames(context),
    createGame: (input: AdminCreateGameInput) => createGame(context, input),
    updateGame: (gameId: string, input: AdminUpdateGameInput) =>
      updateGame(context, gameId, input),
    deleteGame: (gameId: string) => deleteGame(context, gameId),
    uploadGameAsset: (gameId: string, role: GameAssetRole, blob: Blob) =>
      uploadGameAsset(context, gameId, role, blob),
    deleteGameAsset: (gameId: string, role: GameAssetRole) =>
      deleteGameAsset(context, gameId, role),
    fetchWebhooks: () => fetchWebhooks(context),
    createWebhook: (input: AdminWebhookInput) => createWebhook(context, input),
    updateWebhook: (webhookId: string, input: AdminWebhookPatch) =>
      updateWebhook(context, webhookId, input),
    deleteWebhook: (webhookId: string) => deleteWebhook(context, webhookId),
    testWebhook: (webhookId: string) => testWebhook(context, webhookId),
  }
}
