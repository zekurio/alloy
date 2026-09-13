import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRows } from "@alloy/ui/components/setting-row"
import { useState } from "react"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"

import { DesktopAutostartSettings } from "./desktop-autostart-settings"
import { alloyDesktop } from "./desktop-native"
import { DesktopUpdateSettings } from "./desktop-update-settings"

export function DesktopServerSettings() {
  const desktop = alloyDesktop()
  const [error, setError] = useState<string | null>(null)
  if (!desktop) return null

  async function openServers() {
    setError(null)
    try {
      await desktop?.openConnect()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Could not open server settings."),
      )
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-foreground-muted text-sm">{window.location.origin}</p>
      <Button onClick={() => void openServers()}>{t("Manage servers")}</Button>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function DesktopAppPanel() {
  return (
    <SettingsSections>
      <SettingsSubsection
        id="servers"
        title={t("Servers")}
        description={t(
          "Add, switch between, or forget connected Alloy servers.",
        )}
      >
        <DesktopServerSettings />
      </SettingsSubsection>
      <SettingsSubsection
        id="startup"
        title={t("Startup & updates")}
        description={t("Control launch behavior and desktop app updates.")}
      >
        <SettingRows>
          <DesktopAutostartSettings />
          <DesktopUpdateSettings />
        </SettingRows>
      </SettingsSubsection>
    </SettingsSections>
  )
}
