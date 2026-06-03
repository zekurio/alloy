import type { ApiContext } from "./client"
import type { PublicAuthConfig } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import { validatePublicAuthConfig } from "./contract-validators"

export type {
  PublicAuthConfig,
  PublicAuthProvider,
  PublicLoginSplashConfig,
} from "@workspace/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.rpc.api["auth-config"].$get()
      return readJsonOrThrow(res, validatePublicAuthConfig)
    },
  }
}
