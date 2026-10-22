import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

export function AppearanceSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const queryClient = useQueryClient()
  const [enabledPending, setEnabledPending] = useState(false)
  const [enabledError, setEnabledError] = useState<string | null>(null)
  const [treatmentPending, setTreatmentPending] = useState(false)
  const splash = config.appearance.loginSplash
  const [draftBlurPx, setDraftBlurPx] = useState(splash.blurPx)
  const [draftDarkenOpacity, setDraftDarkenOpacity] = useState(
    splash.darkenOpacity,
  )
  const previewSplash = useMemo(
    () => ({
      ...splash,
      blurPx: draftBlurPx,
      darkenOpacity: draftDarkenOpacity,
    }),
    [draftBlurPx, draftDarkenOpacity, splash],
  )
  const treatmentChanged =
    draftBlurPx !== splash.blurPx || draftDarkenOpacity !== splash.darkenOpacity

  useEffect(() => {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }, [splash.blurPx, splash.darkenOpacity])

  async function updateSplashEnabled(next: boolean) {
    if (enabledPending) return
    setEnabledError(null)
    setEnabledPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: { enabled: next },
      })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
    } catch (cause) {
      setEnabledError(errorMessage(cause, t("Couldn't update backdrop")))
    } finally {
      setEnabledPending(false)
    }
  }

  function cancelTreatment() {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }

  async function saveTreatment() {
    if (treatmentPending || !treatmentChanged) return
    setTreatmentPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: {
          blurPx: draftBlurPx,
          darkenOpacity: draftDarkenOpacity,
        },
      })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
    } finally {
      setTreatmentPending(false)
    }
  }

  // The enabled switch applies immediately; only the blur/darkening treatment
  // is deferred, so that's what goes through the unified save bar.
  useSettingsSaveBar({
    dirty: treatmentChanged,
    saving: treatmentPending,
    save: saveTreatment,
    discard: cancelTreatment,
  })

  return (
    <Section>
      <SectionContent className="py-0">
        <SettingsSections>
          <SettingsSubsection
            id="login-backdrop"
            title={t("Login backdrop")}
            description={t(
              "The generated wall of clip thumbnails behind the login form.",
            )}
          >
            <SettingRows>
              <SettingRow
                title={t("Show the backdrop")}
                description={t(
                  "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.",
                )}
                align="start"
              >
                <div className="flex flex-col items-end gap-1.5">
                  <Switch
                    checked={splash.enabled}
                    onCheckedChange={updateSplashEnabled}
                    disabled={enabledPending}
                  />
                  {enabledError ? (
                    <span
                      role="alert"
                      className="text-destructive max-w-48 text-right text-xs"
                    >
                      {enabledError}
                    </span>
                  ) : null}
                </div>
              </SettingRow>
            </SettingRows>

            <LoginAppearancePreview
              config={config}
              splash={previewSplash}
              blurPx={draftBlurPx}
              darkenOpacity={draftDarkenOpacity}
              controlsDisabled={treatmentPending}
              onBlurPxChange={setDraftBlurPx}
              onDarkenOpacityChange={setDraftDarkenOpacity}
            />
          </SettingsSubsection>
        </SettingsSections>
      </SectionContent>
    </Section>
  )
}
