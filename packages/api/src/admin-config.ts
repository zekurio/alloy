import type {
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
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
import { readJsonOrThrow } from "./http"

export type RuntimeConfigPatch = {
  setupComplete?: boolean
}

export type AppearanceConfigPatch = {
  loginSplash?: {
    enabled?: boolean
    blurPx?: number
    darkenOpacity?: number
  }
  customCss?: string
}

export type TranscodingConfigPatch = {
  videoCodec?: VideoCodec
  hardwareAcceleration?: HardwareAcceleration
  vaapiDevice?: string
  quality?: number
  audioBitrateKbps?: number
  tiers?: RenditionTierConfig[]
}

function validateAdminRuntimeConfig(value: unknown): AdminRuntimeConfig {
  return AdminRuntimeConfigSchema.parse(value)
}

export async function fetchRuntimeConfig(
  context: ApiContext,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$get()
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function updateRuntimeConfig(
  context: ApiContext,
  input: RuntimeConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["runtime-config"].$patch({
    json: input,
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function updateAppearanceConfig(
  context: ApiContext,
  patch: AppearanceConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.appearance.$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function updateTranscodingConfig(
  context: ApiContext,
  patch: TranscodingConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin.transcoding.$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function updateAuthConfig(
  context: ApiContext,
  patch: AdminAuthConfigPatch,
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["auth-config"].$patch({ json: patch })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function updateOAuthProviders(
  context: ApiContext,
  providers: AdminOAuthProviderInput[],
): Promise<AdminRuntimeConfig> {
  const res = await context.rpc.api.admin["oauth-providers"].$put({
    json: { providers },
  })
  return readJsonOrThrow(res, validateAdminRuntimeConfig)
}

export async function fetchTranscodingCapabilities(
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
