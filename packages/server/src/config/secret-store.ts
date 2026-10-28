import { env } from "@alloy/server/env"

import { oidcClientSecret } from "./store"

type SecretMap = {
  viewerCookieSecret: string
  uploadHmacSecret: string
  steamgriddbApiKey: string
}

export const secretStore = {
  get<K extends keyof SecretMap>(key: K): SecretMap[K] {
    return env[key]
  },
  /**
   * The OIDC client secret ("" when unset): the one saved in the admin
   * settings, else ALLOY_OIDC_CLIENT_SECRET.
   */
  oidcClientSecret(): string {
    return oidcClientSecret()
  },
} as const
