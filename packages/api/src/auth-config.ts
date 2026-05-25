import type { ApiContext } from "./client"
import type { PublicAuthConfig } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import { validateObject } from "./contract-validators"

export type {
  LoginSplashClip,
  PublicAuthConfig,
  PublicAuthProvider,
  PublicLoginSplashConfig,
} from "@workspace/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.rpc.api["auth-config"].$get()
      return readJsonOrThrow(res, (value) =>
        validateObject<PublicAuthConfig>(value, "auth config")
      )
    },
  }
}
