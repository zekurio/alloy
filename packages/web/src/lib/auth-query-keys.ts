import { t } from "@alloy/i18n"
import { queryOptions } from "@tanstack/react-query"

import { api } from "./api"
import { authClient } from "./auth-client"
import { errorMessage } from "./error-message"

export const authKeys = {
  all: ["auth"] as const,
  backdrops: () => [...authKeys.all, "backdrops"] as const,
  accounts: () => [...authKeys.all, "accounts"] as const,
  passkeys: () => [...authKeys.all, "passkeys"] as const,
  recoveryKey: () => [...authKeys.all, "recovery-key"] as const,
  sessions: () => [...authKeys.all, "sessions"] as const,
}

export function backdropsQueryOptions() {
  return queryOptions({
    queryKey: authKeys.backdrops(),
    queryFn: () => api.authConfig.fetchBackdrops(),
  })
}

export function linkedAccountsQueryOptions() {
  return queryOptions({
    queryKey: authKeys.accounts(),
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts()
      if (error)
        throw new Error(errorMessage(error, t("Couldn't load accounts")))
      return data ?? []
    },
  })
}

export function passkeysQueryOptions() {
  return queryOptions({
    queryKey: authKeys.passkeys(),
    queryFn: async () => {
      const { data, error } = await authClient.passkey.listUserPasskeys()
      if (error)
        throw new Error(errorMessage(error, t("Couldn't load passkeys")))
      return data ?? []
    },
  })
}

export function recoveryKeyStatusQueryOptions() {
  return queryOptions({
    queryKey: authKeys.recoveryKey(),
    queryFn: async () => {
      const { data, error } = await authClient.recoveryKey.status()
      if (error)
        throw new Error(
          errorMessage(error, t("Could not load the recovery key")),
        )
      return data
    },
  })
}

export function sessionsQueryOptions() {
  return queryOptions({
    queryKey: authKeys.sessions(),
    queryFn: async () => {
      const { data, error } = await authClient.listSessions()
      if (error)
        throw new Error(errorMessage(error, t("Couldn't load sessions")))
      return data ?? []
    },
  })
}
