import type { AdminRuntimeConfig } from "@alloy/api"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"

import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { errorMessage } from "@/lib/error-message"

type AdminConfigSetter = React.Dispatch<
  React.SetStateAction<AdminRuntimeConfig | null>
>

interface AdminConfigContextValue {
  config: AdminRuntimeConfig | null
  setConfig: AdminConfigSetter
  loadError: string | null
}

const AdminConfigContext = React.createContext<AdminConfigContextValue | null>(
  null,
)

function useAdminConfig() {
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? errorMessage(configQuery.error, "Couldn't load settings")
    : null

  return { config, setConfig, loadError }
}

export function AdminConfigProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { config, setConfig, loadError } = useAdminConfig()

  const value = React.useMemo<AdminConfigContextValue>(
    () => ({
      config,
      setConfig,
      loadError,
    }),
    [config, setConfig, loadError],
  )

  return (
    <AdminConfigContext.Provider value={value}>
      {children}
    </AdminConfigContext.Provider>
  )
}

export function useAdminConfigContext(): AdminConfigContextValue {
  const value = React.useContext(AdminConfigContext)
  if (!value) {
    throw new Error(
      "useAdminConfigContext must be used within an AdminConfigProvider",
    )
  }
  return value
}

export type { AdminConfigContextValue, AdminConfigSetter }
