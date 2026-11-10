import type {
  AdminAuthConfigPatch,
  AdminOidcConfigPatch,
  AdminRuntimeConfig,
  HardwareAcceleration,
  RenditionTierConfig,
  LimitsConfig,
  ThemeAccents,
  TranscodingCapabilities,
  UploadLimits,
  VideoCodec,
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
  /** `#rrggbb` per appearance, or null for Alloy's own accent. */
  accentColors?: Partial<ThemeAccents>
}

export type TranscodingConfigPatch = {
  videoCodec?: VideoCodec
  hardwareAcceleration?: HardwareAcceleration
  vaapiDevice?: string
  quality?: number
  audioBitrateKbps?: number
  tiers?: RenditionTierConfig[]
}

export function createAdminConfigApi(context: ApiContext) {
  const admin = context.rpc.api.admin

  return {
    async updateUploadLimits(
      limits: Partial<UploadLimits>,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["upload-limits"].$put({ json: limits })
      return readJsonOrThrow(res)
    },
    async updateLimits(
      limits: Partial<LimitsConfig>,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.limits.$put({ json: limits })
      return readJsonOrThrow(res)
    },
    async fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
      const res = await admin["runtime-config"].$get()
      return readJsonOrThrow(res)
    },
    async updateRuntimeConfig(
      input: RuntimeConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["runtime-config"].$patch({ json: input })
      return readJsonOrThrow(res)
    },
    async updateAppearanceConfig(
      patch: AppearanceConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.appearance.$patch({ json: patch })
      return readJsonOrThrow(res)
    },
    async updateTranscodingConfig(
      patch: TranscodingConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.transcoding.$patch({ json: patch })
      return readJsonOrThrow(res)
    },
    async updateAuthConfig(
      patch: AdminAuthConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin["auth-config"].$patch({ json: patch })
      return readJsonOrThrow(res)
    },
    /**
     * Save the OIDC provider. Fields left out fall back to their defaults;
     * see {@link AdminOidcConfigPatch} for the write-only secret.
     */
    async updateOidcConfig(
      config: AdminOidcConfigPatch,
    ): Promise<AdminRuntimeConfig> {
      const res = await admin.oidc.$put({ json: config })
      return readJsonOrThrow(res)
    },
    async fetchTranscodingCapabilities(options?: {
      refresh?: boolean
    }): Promise<TranscodingCapabilities> {
      const res = await admin.transcoding.capabilities.$get({
        query: options?.refresh ? { refresh: "true" } : {},
      })
      return readJsonOrThrow(res)
    },
  }
}
