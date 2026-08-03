import type {
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"

import { EnvManagedNote } from "@/components/routes/settings/admin-env-note"
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
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
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)

  async function updateToggle(key: AuthToggleKey, next: boolean) {
    if (pendingToggle) return
    setToggleError(null)
    setPendingToggle(key)
    try {
      const updated = await api.admin.updateAuthConfig({ [key]: next })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
    } catch (cause) {
      setToggleError(errorMessage(cause, t("Couldn't update authentication")))
    } finally {
      setPendingToggle(null)
    }
  }

  async function saveProviders(providers: AdminOAuthProviderInput[]) {
    if (providerPending) return false
    setProviderError(null)
    setProviderPending(true)
    try {
      const updated = await api.admin.updateOAuthProviders(providers)
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      return true
    } catch (cause) {
      setProviderError(errorMessage(cause, t("Couldn't save OAuth providers")))
      return false
    } finally {
      setProviderPending(false)
    }
  }

  return (
    <Section>
      <SectionContent className="py-0">
        <SettingsSections>
          <SettingsSubsection
            id="sign-in"
            title={t("Sign-in")}
            description={t(
              "Who can create an account and how they authenticate.",
            )}
          >
            <SettingRows>
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
            </SettingRows>
            {toggleError ? (
              <Callout tone="destructive" className="mt-3 text-xs">
                <CircleAlertIcon />
                <span>{toggleError}</span>
              </Callout>
            ) : null}
          </SettingsSubsection>

          <OAuthProviderSettings
            config={config}
            pending={providerPending}
            error={providerError}
            onSave={saveProviders}
          />
        </SettingsSections>
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
