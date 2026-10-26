import type {
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
  ContractJsonInput,
  HardwareAcceleration,
  RenditionTierConfig,
  ThemeAccents,
  TranscodingCapabilities,
  UploadLimits,
  VideoCodec,
} from "@alloy/contracts"
import {
  AdminRuntimeConfigSchema,
  TranscodingCapabilitiesSchema,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import { blobAsFile } from "./form-file"
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
  /** `#rrggbb` per appearance, or null to restore Alloy's own accent. */
  accentColors?: ThemeAccents
}

export type TranscodingConfigPatch = {
  videoCodec?: VideoCodec
  hardwareAcceleration?: HardwareAcceleration
  vaapiDevice?: string
  quality?: number
  audioBitrateKbps?: number
  tiers?: RenditionTierConfig[]
}

function validateAdminRuntimeConfig(
  value: ContractJsonInput,
): AdminRuntimeConfig {
  return AdminRuntimeConfigSchema.parse(value)
}

function validateTranscodingCapabilities(
  value: ContractJsonInput,
): TranscodingCapabilities {
  return TranscodingCapabilitiesSchema.parse(value)
}

export function createAdminConfigApi(context: ApiContext) {
  const admin = context.rpc.api.admin

  return {
    async updateUploadLimits(
      limits: UploadLimits,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["upload-limits"].$put({ json: limits })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
      const res = await admin["runtime-config"].$get()
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async updateRuntimeConfig(
      input: RuntimeConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["runtime-config"].$patch({ json: input })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async updateAppearanceConfig(
      patch: AppearanceConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.appearance.$patch({ json: patch })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async updateTranscodingConfig(
      patch: TranscodingConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.transcoding.$patch({ json: patch })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async updateAuthConfig(
      patch: AdminAuthConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["auth-config"].$patch({ json: patch })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async updateOAuthProviders(
      providers: AdminOAuthProviderInput[],
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["oauth-providers"].$put({ json: { providers } })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async uploadOAuthProviderIcon(
      providerId: string,
      blob: Blob,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["oauth-providers"][":providerId"].icon.$post({
        param: { providerId },
        form: { file: blobAsFile(blob, "icon") },
      })
      return readJsonOrThrow(res, validateAdminRuntimeConfig)
    },
    async fetchTranscodingCapabilities(options?: {
      refresh?: boolean
    }): Promise<TranscodingCapabilities> {
      const res = await admin.transcoding.capabilities.$get({
        query: options?.refresh ? { refresh: "true" } : {},
      })
      return readJsonOrThrow(res, validateTranscodingCapabilities)
    },
  }
}
