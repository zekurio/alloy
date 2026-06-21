import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useQuery } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { errorMessage } from "@/lib/error-message"

type AdminConfigSetter = Dispatch<SetStateAction<AdminRuntimeConfig | null>>

interface AdminConfigContextValue {
  config: AdminRuntimeConfig | null
  setConfig: AdminConfigSetter
  loadError: string | null
}

const AdminConfigContext = createContext<AdminConfigContextValue | null>(null)

function useAdminConfig() {
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())
  const [config, setConfig] = useState<AdminRuntimeConfig | null>(null)

  useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? errorMessage(configQuery.error, t("Couldn't load settings"))
    : null

  return { config, setConfig, loadError }
}

export function AdminConfigProvider({ children }: { children: ReactNode }) {
  const { config, setConfig, loadError } = useAdminConfig()

  const value = useMemo<AdminConfigContextValue>(
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
  const value = useContext(AdminConfigContext)
  if (!value) {
    throw new Error(
      "useAdminConfigContext must be used within an AdminConfigProvider",
    )
  }
  return value
}

export type { AdminConfigContextValue, AdminConfigSetter }
