import type { PublicAuthConfig } from "@workspace/contracts"

import type { ApiContext } from "./client"
import { validatePublicAuthConfig } from "./contract-validators"
import { readJsonOrThrow } from "./http"

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
