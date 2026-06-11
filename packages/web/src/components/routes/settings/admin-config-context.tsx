import type { AdminRuntimeConfig } from "@alloy/api"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"

import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

type BoolToggleKey =
  | "openRegistrations"
  | "passkeyEnabled"
  | "requireAuthToBrowse"

type AdminConfigSetter = React.Dispatch<
  React.SetStateAction<AdminRuntimeConfig | null>
>

interface AdminConfigContextValue {
  config: AdminRuntimeConfig | null
  setConfig: AdminConfigSetter
  loadError: string | null
  pendingToggleKey: BoolToggleKey | null
  onToggleOpenRegistrations: (next: boolean) => void
  onTogglePasskey: (next: boolean) => void
  onToggleRequireAuthToBrowse: (next: boolean) => void
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

function useAdminToggles(setConfig: AdminConfigSetter) {
  const [pendingKey, setPendingKey] = React.useState<BoolToggleKey | null>(null)
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string,
  ) => {
    if (pendingKey) return
    let previous: AdminRuntimeConfig | null = null
    setPendingKey(key)
    setConfig((prev) => {
      previous = prev
      return prev ? { ...prev, [key]: next } : prev
    })
    try {
      const updated = await api.admin.updateRuntimeConfig({ [key]: next })
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig(previous)
      toast.error(errorMessage(cause, "Update failed"))
    } finally {
      setPendingKey(null)
    }
  }
  return {
    pendingKey,
    onToggleOpenRegistrations: (next: boolean) =>
      patch(
        "openRegistrations",
        next,
        next ? "Registrations open" : "Registrations closed",
      ),
    onTogglePasskey: (next: boolean) =>
      patch(
        "passkeyEnabled",
        next,
        next ? "Passkeys enabled" : "Passkeys disabled",
      ),
    onToggleRequireAuthToBrowse: (next: boolean) =>
      patch(
        "requireAuthToBrowse",
        next,
        next ? "Sign-in required to browse" : "Public browsing enabled",
      ),
  }
}

export function AdminConfigProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { config, setConfig, loadError } = useAdminConfig()
  const {
    pendingKey,
    onToggleOpenRegistrations,
    onTogglePasskey,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  const value = React.useMemo<AdminConfigContextValue>(
    () => ({
      config,
      setConfig,
      loadError,
      pendingToggleKey: pendingKey,
      onToggleOpenRegistrations,
      onTogglePasskey,
      onToggleRequireAuthToBrowse,
    }),
    [
      config,
      setConfig,
      loadError,
      pendingKey,
      onToggleOpenRegistrations,
      onTogglePasskey,
      onToggleRequireAuthToBrowse,
    ],
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

export type { AdminConfigContextValue, AdminConfigSetter, BoolToggleKey }
