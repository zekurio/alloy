import type { ApiContext } from "./client"
import type { PublicAuthConfig } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  LoginSplashClip,
  PublicAuthConfig,
  PublicAuthProvider,
  PublicLoginSplashConfig,
} from "@workspace/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.request("/api/auth-config")
      return readJsonOrThrow<PublicAuthConfig>(res)
    },
  }
}
