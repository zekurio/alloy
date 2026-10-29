import type { AdminAuthConfigPatch, AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { CircleAlertIcon, InfoIcon } from "lucide-react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { OidcSettings } from "./admin-oidc-settings"

type AuthToggleKey = keyof AdminAuthConfigPatch

const AUTH_TOGGLES: {
  key: AuthToggleKey
  label: string
  description: string
}[] = [
  {
    key: "openRegistrations",
    label: t("Open registrations"),
    description: t(
      "Let anyone create an account with a passkey. Single sign-on has its own Create accounts setting.",
    ),
  },
  {
    key: "passkeyEnabled",
    label: t("Passkeys"),
    description: t(
      "Enable password-free sign-in and registration with passkeys.",
    ),
  },
  {
    key: "requireAuthToBrowse",
    label: t("Require sign-in to browse"),
    description: t(
      "Redirect signed-out visitors to login before they can browse.",
    ),
  },
]

export function AuthSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const toggle = useAdminConfigMutation(
    ({ key, enabled }: { key: AuthToggleKey; enabled: boolean }) =>
      api.admin.updateAuthConfig({ [key]: enabled }),
    { authConfigChanged: true },
  )
  const pendingToggle = toggle.isPending ? toggle.variables.key : null

  function setToggle(key: AuthToggleKey, enabled: boolean) {
    if (!toggle.isPending) toggle.mutate({ key, enabled })
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
                <SettingRow
                  key={item.key}
                  title={item.label}
                  description={item.description}
                  align="start"
                >
                  <Switch
                    checked={config[item.key]}
                    onCheckedChange={(enabled) => setToggle(item.key, enabled)}
                    disabled={pendingToggle === item.key}
                  />
                </SettingRow>
              ))}
            </SettingRows>
            <SignUpNotice config={config} />
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

          <OidcSettings config={config} />
        </SettingsSections>
      </SectionContent>
    </Section>
  )
}

/**
 * Open registrations does not close single sign-on sign-up, so say so while
 * the provider still creates accounts.
 */
function SignUpNotice({ config }: { config: AdminRuntimeConfig }) {
  if (
    config.openRegistrations ||
    !config.oidc.enabled ||
    !config.oidc.allowSignUp
  ) {
    return null
  }
  return (
    <Callout tone="info" className="mt-3 text-xs">
      <InfoIcon />
      <span>
        {t(
          "Open registrations is off, but {provider} still creates accounts on first sign-in. Turn off Create accounts under Single sign-on to stop it.",
          { provider: config.oidc.displayName },
        )}
      </span>
    </Callout>
  )
}
