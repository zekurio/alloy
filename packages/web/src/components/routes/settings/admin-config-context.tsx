import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"

import {
  adminKeys,
  adminRuntimeConfigQueryOptions,
} from "@/lib/admin-query-keys"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

interface AdminConfigContextValue {
  config: AdminRuntimeConfig | null
  loadError: string | null
}

const AdminConfigContext = createContext<AdminConfigContextValue | null>(null)

export function AdminConfigProvider({ children }: { children: ReactNode }) {
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())
  const loadError = configQuery.error
    ? errorMessage(configQuery.error, t("Couldn't load settings"))
    : null

  // The runtime-config query cache is the single source of truth; panels write
  // saved configs back via setQueryData rather than a shadow copy in state.
  const value = useMemo<AdminConfigContextValue>(
    () => ({ config: configQuery.data ?? null, loadError }),
    [configQuery.data, loadError],
  )

  return (
    <AdminConfigContext.Provider value={value}>
      {children}
    </AdminConfigContext.Provider>
  )
}

export function useAdminConfigContext(): AdminConfigContextValue {
  const value = useContext(AdminConfigContext)
  if (!value) {
    throw new Error(
      "useAdminConfigContext must be used within an AdminConfigProvider",
    )
  }
  return value
}

/**
 * Saves part of the runtime config. The server answers with the whole config,
 * which replaces the cached copy the panels read. `authConfigChanged` also
 * refreshes the public auth config the rest of the app reads.
 */
export function useAdminConfigMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<AdminRuntimeConfig>,
  { authConfigChanged = false }: { authConfigChanged?: boolean } = {},
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (updated) => {
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      if (authConfigChanged) publishRuntimeConfigUpdate({ authConfigChanged })
    },
  })
}

export type { AdminConfigContextValue }
