import type { ApiContext } from "./client"
import { readJsonOrThrow } from "./http"

export interface PublicAuthProvider {
  providerId: string
  displayName: string
}

export interface PublicAuthConfig {
  setupRequired: boolean
  openRegistrations: boolean
  emailPasswordEnabled: boolean
  requireAuthToBrowse: boolean
  provider: PublicAuthProvider | null
}

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.client.api["auth-config"].$get()
      return readJsonOrThrow<PublicAuthConfig>(res)
    },
  }
}
