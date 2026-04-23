import type { ApiContext } from "./client"
import type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
} from "@workspace/db/contracts"
import { readJsonOrThrow } from "./http"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HEIGHT_SUGGESTIONS,
  ENCODER_HWACCELS,
  INTEGRATIONS_REDACTED,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/db/contracts"
export type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminEncoderVariant,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  EncoderCodec,
  EncoderHwaccel,
  UsernameClaim,
} from "@workspace/db/contracts"

export function createAdminApi(context: ApiContext) {
  return {
    async fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["runtime-config"].$get()
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateRuntimeConfig(input: {
      openRegistrations?: boolean
      emailPasswordEnabled?: boolean
      passkeyEnabled?: boolean
      requireAuthToBrowse?: boolean
    }): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["runtime-config"].$patch({
        json: input,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async saveOAuthConfig(input: {
      oauthProvider: AdminOAuthProvider | null
    }): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin["oauth-config"].$put({
        json: {
          oauthProvider: input.oauthProvider ? { ...input.oauthProvider } : null,
        },
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateEncoderConfig(
      patch: Partial<AdminEncoderConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.encoder.$patch({ json: patch })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateLimitsConfig(
      patch: Partial<AdminLimitsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.limits.$patch({ json: patch })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateIntegrationsConfig(
      patch: Partial<AdminIntegrationsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.client.api.admin.integrations.$patch({
        json: patch,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async fetchEncoderCapabilities(): Promise<AdminEncoderCapabilities> {
      const res = await context.client.api.admin.encoder.capabilities.$get()
      return readJsonOrThrow<AdminEncoderCapabilities>(res)
    },

    async reEncodeAllClips(): Promise<{ enqueued: number }> {
      const res = await context.client.api.admin.clips["re-encode"].$post()
      return readJsonOrThrow<{ enqueued: number }>(res)
    },
  }
}
