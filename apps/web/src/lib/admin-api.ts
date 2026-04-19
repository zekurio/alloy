import { api } from "./api"

/** Mirror of `OAuthProviderConfig` on the server (see lib/config-store.ts). */
export interface AdminOAuthProvider {
  providerId: string
  buttonText: string
  clientId: string
  /** Always empty on read; admins re-enter on every save. */
  clientSecret: string
  scopes?: string[]
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  pkce?: boolean
}

export interface AdminRuntimeConfig {
  openRegistrations: boolean
  setupComplete: boolean
  emailPasswordEnabled: boolean
  oauthProvider: AdminOAuthProvider | null
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["runtime-config"].$get()
  return readJson<AdminRuntimeConfig>(res)
}

export async function updateRuntimeConfig(
  input: { openRegistrations?: boolean; emailPasswordEnabled?: boolean },
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["runtime-config"].$patch({ json: input })
  return readJson<AdminRuntimeConfig>(res)
}

export async function saveOAuthProvider(
  provider: AdminOAuthProvider,
): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["oauth-provider"].$put({ json: provider })
  return readJson<AdminRuntimeConfig>(res)
}

export async function deleteOAuthProvider(): Promise<AdminRuntimeConfig> {
  const res = await api.api.admin["oauth-provider"].$delete()
  return readJson<AdminRuntimeConfig>(res)
}
