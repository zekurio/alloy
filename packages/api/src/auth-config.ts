import type { LoginBackdropsResponse, PublicAuthConfig } from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateLoginBackdropsResponse,
  validatePublicAuthConfig,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"

export type {
  LoginBackdropsResponse,
  PublicAuthConfig,
  PublicAuthProvider,
  PublicLoginSplashConfig,
} from "@alloy/contracts"

export function createAuthConfigApi(context: ApiContext) {
  return {
    async fetch(): Promise<PublicAuthConfig> {
      const res = await context.rpc.api["auth-config"].$get()
      return readJsonOrThrow(res, validatePublicAuthConfig)
    },
    async fetchBackdrops(): Promise<LoginBackdropsResponse> {
      const res = await context.rpc.api["auth-config"].backdrops.$get()
      return readJsonOrThrow(res, validateLoginBackdropsResponse)
    },
  }
}
