import type {
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

import { OAuthProviderSettings } from "./admin-auth-provider-settings"
type AuthToggleKey = keyof AdminAuthConfigPatch

const AUTH_TOGGLES: {
  key: AuthToggleKey
  label: string
  description: string
  envName: string
}[] = [
  {
    key: "openRegistrations",
    label: t("Open registrations"),
    description: t("Allow new users to create accounts on this server."),
    envName: "ALLOY_OPEN_REGISTRATIONS",
  },
  {
    key: "passkeyEnabled",
    label: t("Passkeys"),
    description: t(
      "Enable password-free sign-in and registration with passkeys.",
    ),
    envName: "ALLOY_PASSKEY_ENABLED",
  },
  {
    key: "requireAuthToBrowse",
    label: t("Require sign-in to browse"),
    description: t(
      "Redirect signed-out visitors to login before they can browse.",
    ),
    envName: "ALLOY_REQUIRE_AUTH_TO_BROWSE",
  },
]

export function AuthSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const queryClient = useQueryClient()
  const [pendingToggle, setPendingToggle] = useState<AuthToggleKey | null>(null)
  const [providerPending, setProviderPending] = useState(false)

  async function updateToggle(key: AuthToggleKey, next: boolean) {
    if (pendingToggle) return
    setPendingToggle(key)
    try {
      const updated = await api.admin.updateAuthConfig({ [key]: next })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("Authentication setting saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update authentication")))
    } finally {
      setPendingToggle(null)
    }
  }

  async function saveProviders(providers: AdminOAuthProviderInput[]) {
    if (providerPending) return false
    setProviderPending(true)
    try {
      const updated = await api.admin.updateOAuthProviders(providers)
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("OAuth providers saved"))
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save OAuth providers")))
      return false
    } finally {
      setProviderPending(false)
    }
  }

  return (
    <Section>
      <SectionContent className="flex flex-col gap-6 py-0">
        <div className="flex flex-col">
          {AUTH_TOGGLES.map((item) => (
            <AuthToggleRow
              key={item.key}
              item={item}
              checked={config[item.key]}
              locked={config.authLocks[item.key]}
              pending={pendingToggle === item.key}
              onChange={(next) => updateToggle(item.key, next)}
            />
          ))}
        </div>

        <OAuthProviderSettings
          config={config}
          pending={providerPending}
          onSave={saveProviders}
        />
      </SectionContent>
    </Section>
  )
}

function AuthToggleRow({
  item,
  checked,
  locked,
  pending,
  onChange,
}: {
  item: (typeof AUTH_TOGGLES)[number]
  checked: boolean
  locked: boolean
  pending: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <SettingRow
      title={item.label}
      description={
        locked ? (
          <>
            {item.description}
            <EnvManagedNote envName={item.envName} />
          </>
        ) : (
          item.description
        )
      }
      align="start"
    >
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={locked || pending}
      />
    </SettingRow>
  )
}

function EnvManagedNote({
  envName,
  className,
}: {
  envName: string
  className?: string
}) {
  // Rendered as a span so it can live inside SettingRow's <p> description.
  return (
    <span
      className={cn(
        "text-foreground-muted mt-1 flex flex-wrap items-center gap-1 text-xs",
        className,
      )}
    >
      {t("Managed by environment variable")}:{" "}
      <code className="bg-surface-raised text-foreground-dim rounded px-1 py-px font-mono text-[11px]">
        {envName}
      </code>
    </span>
  )
}
