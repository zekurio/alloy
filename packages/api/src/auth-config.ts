import type { ApiContext } from "./client"
import type {
  PasskeySignUpRequest,
  PasskeySignUpResponse,
  PublicAuthConfig,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  PasskeySignUpRequest,
  PasskeySignUpResponse,
  PublicAuthConfig,
  PublicAuthProvider,
} from "@workspace/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.request("/api/auth-config")
      return readJsonOrThrow<PublicAuthConfig>(res)
    },

    async createPasskeySignUp(
      input: PasskeySignUpRequest
    ): Promise<PasskeySignUpResponse> {
      const res = await context.request("/api/auth-config/passkey-sign-up", {
        method: "POST",
        json: input,
      })
      return readJsonOrThrow<PasskeySignUpResponse>(res)
    },
  }
}
