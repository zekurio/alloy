import type { ApiContext } from "./client"
import type {
  PasskeySignUpRequest,
  PasskeySignUpResponse,
  PublicAuthConfig,
} from "@workspace/db/contracts"
import { readJsonOrThrow } from "./http"

export type {
  PasskeySignUpRequest,
  PasskeySignUpResponse,
  PublicAuthConfig,
  PublicAuthProvider,
} from "@workspace/db/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.client.api["auth-config"].$get()
      return readJsonOrThrow<PublicAuthConfig>(res)
    },

    async createPasskeySignUp(
      input: PasskeySignUpRequest
    ): Promise<PasskeySignUpResponse> {
      const res = await context.client.api["auth-config"]["passkey-sign-up"].$post(
        {
          json: input,
        }
      )
      return readJsonOrThrow<PasskeySignUpResponse>(res)
    },
  }
}
