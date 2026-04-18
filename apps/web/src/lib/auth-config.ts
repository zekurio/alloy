import { api } from "./api"

export interface PublicAuthProvider {
  providerId: string
  buttonText: string
}

export interface PublicAuthConfig {
  setupRequired: boolean
  openRegistrations: boolean
  provider: PublicAuthProvider | null
}

export async function fetchAuthConfig(): Promise<PublicAuthConfig> {
  const res = await api.api["auth-config"].$get()
  if (!res.ok) {
    throw new Error(`auth-config request failed: ${res.status}`)
  }
  return (await res.json()) as PublicAuthConfig
}
