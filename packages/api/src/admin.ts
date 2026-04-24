import type { ApiContext } from "./client"
import type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminUpdateUserStorageQuotaInput,
  AdminUserStorageRow,
  AdminUsersResponse,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  INTEGRATIONS_REDACTED,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/contracts"
export type {
  AdminEncoderCapabilities,
  AdminEncoderConfig,
  AdminEncoderVariant,
  AdminIntegrationsConfig,
  AdminLimitsConfig,
  AdminOAuthProvider,
  AdminRuntimeConfig,
  AdminUpdateUserStorageQuotaInput,
  AdminUsersResponse,
  AdminUserStorageRow,
  EncoderCodec,
  EncoderHwaccel,
  UsernameClaim,
} from "@workspace/contracts"

export function createAdminApi(context: ApiContext) {
  return {
    async fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/runtime-config")
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateRuntimeConfig(input: {
      openRegistrations?: boolean
      emailPasswordEnabled?: boolean
      passkeyEnabled?: boolean
      requireAuthToBrowse?: boolean
    }): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/runtime-config", {
        method: "PATCH",
        json: input,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async saveOAuthConfig(input: {
      oauthProvider: AdminOAuthProvider | null
    }): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/oauth-config", {
        method: "PUT",
        json: {
          oauthProvider: input.oauthProvider
            ? { ...input.oauthProvider }
            : null,
        },
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateEncoderConfig(
      patch: Partial<AdminEncoderConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/encoder", {
        method: "PATCH",
        json: patch,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateLimitsConfig(
      patch: Partial<AdminLimitsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/limits", {
        method: "PATCH",
        json: patch,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async updateIntegrationsConfig(
      patch: Partial<AdminIntegrationsConfig>
    ): Promise<AdminRuntimeConfig> {
      const res = await context.request("/api/admin/integrations", {
        method: "PATCH",
        json: patch,
      })
      return readJsonOrThrow<AdminRuntimeConfig>(res)
    },

    async fetchEncoderCapabilities(): Promise<AdminEncoderCapabilities> {
      const res = await context.request("/api/admin/encoder/capabilities")
      return readJsonOrThrow<AdminEncoderCapabilities>(res)
    },

    async reEncodeAllClips(): Promise<{ enqueued: number }> {
      const res = await context.request("/api/admin/clips/re-encode", {
        method: "POST",
      })
      return readJsonOrThrow<{ enqueued: number }>(res)
    },

    async fetchUsers(): Promise<AdminUsersResponse> {
      const res = await context.request("/api/admin/users")
      return readJsonOrThrow<AdminUsersResponse>(res)
    },

    async updateUserStorageQuota(
      userId: string,
      input: AdminUpdateUserStorageQuotaInput
    ): Promise<AdminUserStorageRow> {
      const res = await context.request(
        `/api/admin/users/${encodeURIComponent(userId)}/storage-quota`,
        {
          method: "PATCH",
          json: input,
        }
      )
      return readJsonOrThrow<AdminUserStorageRow>(res)
    },
  }
}
