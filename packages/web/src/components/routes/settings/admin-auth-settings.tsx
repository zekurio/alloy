import type {
  AdminAuthConfigPatch,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
} from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { useState } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
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
import type { ProviderIconUpload } from "./admin-auth-provider-utils"
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
    description: t(
      "Let anyone create an account with a passkey. OAuth providers have their own Create accounts setting.",
    ),
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
  const toggle = useAdminConfigMutation(
    ({ key, enabled }: { key: AuthToggleKey; enabled: boolean }) =>
      api.admin.updateAuthConfig({ [key]: enabled }),
    { authConfigChanged: true },
  )
  const pendingToggle = toggle.isPending ? toggle.variables.key : null
  const [providerPending, setProviderPending] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)

  async function saveProviders(
    providers: AdminOAuthProviderInput[],
    iconUpload?: ProviderIconUpload,
  ) {
    if (providerPending) return false
    setProviderError(null)
    setProviderPending(true)
    try {
      // Apply the list update before the icon upload so a failed upload still
      // leaves the saved provider list visible (with the error shown).
      const updated = await api.admin.updateOAuthProviders(providers)
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      if (iconUpload) {
        const withIcon = await api.admin.uploadOAuthProviderIcon(
          iconUpload.providerId,
          iconUpload.file,
        )
        queryClient.setQueryData(adminKeys.runtimeConfig(), withIcon)
        publishRuntimeConfigUpdate({ authConfigChanged: true })
      }
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
                  description={toggleDescription(item, config)}
                  checked={config[item.key]}
                  locked={config.authLocks[item.key]}
                  pending={pendingToggle === item.key}
                  onChange={(enabled) => {
                    if (!toggle.isPending)
                      toggle.mutate({ key: item.key, enabled })
                  }}
                />
              ))}
            </SettingRows>
            <SignUpProvidersNotice config={config} />
            {toggle.error ? (
              <Callout tone="destructive" className="mt-3 text-xs">
                <CircleAlertIcon />
                <span>
                  {errorMessage(
                    toggle.error,
                    t("Couldn't update authentication"),
                  )}
                </span>
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

/**
 * Env-managed providers without allow_sign_up still follow open
 * registrations, since the server can't save a value for them.
 */
function toggleDescription(
  item: (typeof AUTH_TOGGLES)[number],
  config: AdminRuntimeConfig,
): string {
  if (item.key !== "openRegistrations" || !config.authLocks.oauthProviders) {
    return item.description
  }
  return t(
    "Let anyone create an account with a passkey. Env-managed OAuth providers without allow_sign_up also follow this setting.",
  )
}

/**
 * Open registrations no longer closes OAuth sign-up, so say which providers
 * still create accounts while it is off.
 */
function SignUpProvidersNotice({ config }: { config: AdminRuntimeConfig }) {
  if (config.openRegistrations) return null
  const names = config.oauthProviders
    .filter((provider) => provider.enabled && provider.allowSignUp)
    .map((provider) => provider.displayName)
  if (names.length === 0) return null
  return (
    <Callout tone="info" className="mt-3 text-xs">
      <InfoIcon />
      <span>
        {tp(
          names.length,
          "Open registrations is off, but {providers} still creates accounts on first sign-in. Turn off Create accounts on the provider to stop it.",
          "Open registrations is off, but {providers} still create accounts on first sign-in. Turn off Create accounts on a provider to stop it.",
          { providers: names.join(", ") },
        )}
      </span>
    </Callout>
  )
}

function AuthToggleRow({
  item,
  description,
  checked,
  locked,
  pending,
  onChange,
}: {
  item: (typeof AUTH_TOGGLES)[number]
  description: string
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
            {description}
            <EnvManagedNote envName={item.envName} />
          </>
        ) : (
          description
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
