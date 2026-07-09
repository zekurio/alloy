import type {
  AdminAuthConfigPatch,
  AdminCreateGameInput,
  AdminFailedJobsPage,
  AdminGameRow,
  AdminJobsSummary,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
  AdminSweepKind,
  AdminUpdateGameInput,
  AdminUpdateUserInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  GameAssetRole,
  HardwareAcceleration,
  RenditionTierConfig,
  TranscodingCapabilities,
  VideoCodec,
} from "@alloy/contracts"
import {
  AdminRuntimeConfigSchema,
  TranscodingCapabilitiesSchema,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateAdminFailedJobsPage,
  validateAdminGameRow,
  validateAdminGameRows,
  validateAdminJobsSummary,
  validateAdminReEncodeResponse,
  validateAdminUsersResponse,
  validateAdminUserStorageRow,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readDeletedJson, readSuccessJson } from "./mutations"
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

type RuntimeConfigPatch = {
  setupComplete?: boolean
}

type AppearanceConfigPatch = {
  loginSplash?: {
    enabled?: boolean
    blurPx?: number
    darkenOpacity?: number
  }
}

type TranscodingConfigPatch = {
  videoCodec?: VideoCodec
  hardwareAcceleration?: HardwareAcceleration
  vaapiDevice?: string
  quality?: number
  audioBitrateKbps?: number
  tiers?: RenditionTierConfig[]
}

type AdminCreateUserInput = {
  email: string
  username?: string
  role?: "user" | "admin"
}

function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  return AdminRuntimeConfigSchema.parse(value)
}

async function fetchRuntimeConfig(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$get()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateRuntimeConfig(
  context: ApiContext,
  input: RuntimeConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$patch({
    json: input,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateAppearanceConfig(
  context: ApiContext,
  patch: AppearanceConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.appearance.$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateTranscodingConfig(
  context: ApiContext,
  patch: TranscodingConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.transcoding.$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateAuthConfig(
  context: ApiContext,
  patch: AdminAuthConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["auth-config"].$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function updateOAuthProviders(
  context: ApiContext,
  providers: AdminOAuthProviderInput[],
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["oauth-providers"].$put({
    json: { providers },
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

async function fetchTranscodingCapabilities(
  context: ApiContext,
  options?: { refresh?: boolean },
): Promise<TranscodingCapabilities> {
  const res = await context.rpc.api.admin.transcoding.capabilities.$get({
    query: options?.refresh ? { refresh: "true" } : {},
  })
  return readJsonOrThrow(res, (value) =>
    TranscodingCapabilitiesSchema.parse(value),
  )
}

async function reEncodeAllClips(
  context: ApiContext,
): Promise<{ enqueued: number; hasMore: boolean }> {
  const res = await context.rpc.api.admin.clips["re-encode"].$post()
  return readJsonOrThrow(res, validateAdminReEncodeResponse)
}

async function fetchJobsSummary(
  context: ApiContext,
): Promise<AdminJobsSummary> {
  const res = await context.rpc.api.admin.jobs.summary.$get()
  return readJsonOrThrow(res, validateAdminJobsSummary)
}

async function fetchFailedJobs(
  context: ApiContext,
  options: { kind?: string; cursor?: string; limit?: number } = {},
): Promise<AdminFailedJobsPage> {
  const res = await context.rpc.api.admin.jobs.failed.$get({
    query: {
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit ? { limit: String(options.limit) } : {}),
    },
  })
  return readJsonOrThrow(res, validateAdminFailedJobsPage)
}

async function retryJob(context: ApiContext, jobId: string): Promise<void> {
  const res = await context.rpc.api.admin.jobs[":id"].retry.$post({
    param: { id: jobId },
  })
  await readSuccessJson(res)
}

async function discardJob(context: ApiContext, jobId: string): Promise<void> {
  const res = await context.rpc.api.admin.jobs[":id"].discard.$post({
    param: { id: jobId },
  })
  await readSuccessJson(res)
}

async function runJobSweep(
  context: ApiContext,
  kind: AdminSweepKind,
  mode: "stale" | "force" = "stale",
): Promise<void> {
  const res = await context.rpc.api.admin.jobs.sweeps[":kind"].$post({
    param: { kind },
    json: { mode },
  })
  await readSuccessJson(res)
}

async function setJobKindPaused(
  context: ApiContext,
  kind: string,
  paused: boolean,
): Promise<void> {
  const res = paused
    ? await context.rpc.api.admin.jobs.kinds[":kind"].pause.$post({
        param: { kind },
      })
    : await context.rpc.api.admin.jobs.kinds[":kind"].resume.$post({
        param: { kind },
      })
  await readSuccessJson(res)
}

async function fetchUsers(
  context: ApiContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<AdminUsersResponse> {
  const res = await context.rpc.api.admin.users.$get({
    query: {
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit ? { limit: String(options.limit) } : {}),
    },
  })
  return readJsonOrThrow(res, validateAdminUsersResponse)
}

async function createUser(
  context: ApiContext,
  input: AdminCreateUserInput,
): Promise<AdminUserStorageRow> {
  const res = await context.rpc.api.admin.users.$post({ json: input })
  return readJsonOrThrow(res, validateAdminUserStorageRow)
}

async function updateUser(
  context: ApiContext,
  userId: string,
  input: AdminUpdateUserInput,
): Promise<AdminUserStorageRow> {
  const res = await context.rpc.api.admin.users[":id"].$patch({
    param: { id: userId },
    json: input,
  })
  return readJsonOrThrow(res, validateAdminUserStorageRow)
}

async function deleteUser(context: ApiContext, userId: string): Promise<void> {
  const res = await context.rpc.api.admin.users[":id"].$delete({
    param: { id: userId },
  })
  await readSuccessJson(res)
}

async function fetchGames(context: ApiContext): Promise<AdminGameRow[]> {
  const res = await context.rpc.api.admin.games.$get()
  return readJsonOrThrow(res, validateAdminGameRows)
}

async function createGame(
  context: ApiContext,
  input: AdminCreateGameInput,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games.$post({
    form: {
      name: input.name,
      ...(input.releaseDate ? { releaseDate: input.releaseDate } : {}),
      ...(input.assets?.hero ? { hero: input.assets.hero } : {}),
      ...(input.assets?.grid ? { grid: input.assets.grid } : {}),
      ...(input.assets?.logo ? { logo: input.assets.logo } : {}),
      ...(input.assets?.icon ? { icon: input.assets.icon } : {}),
    },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function updateGame(
  context: ApiContext,
  gameId: string,
  input: AdminUpdateGameInput,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games[":id"].$patch({
    param: { id: gameId },
    json: input,
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function deleteGame(context: ApiContext, gameId: string): Promise<void> {
  const res = await context.rpc.api.admin.games[":id"].$delete({
    param: { id: gameId },
  })
  await readDeletedJson(res)
}

async function uploadGameAsset(
  context: ApiContext,
  gameId: string,
  role: GameAssetRole,
  blob: Blob,
): Promise<AdminGameRow> {
  const file =
    blob instanceof File ? blob : new File([blob], role, { type: blob.type })
  const res = await context.rpc.api.admin.games[":id"].assets[":role"].$post({
    param: { id: gameId, role },
    form: { file },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

async function deleteGameAsset(
  context: ApiContext,
  gameId: string,
  role: GameAssetRole,
): Promise<AdminGameRow> {
  const res = await context.rpc.api.admin.games[":id"].assets[":role"].$delete({
    param: { id: gameId, role },
  })
  return readJsonOrThrow(res, validateAdminGameRow)
}

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
    fetchUsers: (options?: { cursor?: string; limit?: number }) =>
      fetchUsers(context, options),
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
  }
}
