import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useEffect, useMemo, useState } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

export function AppearanceSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const toggleSplash = useAdminConfigMutation(
    (enabled: boolean) =>
      api.admin.updateAppearanceConfig({ loginSplash: { enabled } }),
    { authConfigChanged: true },
  )
  const saveSplashTreatment = useAdminConfigMutation(
    (treatment: { blurPx: number; darkenOpacity: number }) =>
      api.admin.updateAppearanceConfig({ loginSplash: treatment }),
    { authConfigChanged: true },
  )
  const treatmentPending = saveSplashTreatment.isPending
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

  function cancelTreatment() {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }

  async function saveTreatment() {
    if (treatmentPending || !treatmentChanged) return
    await saveSplashTreatment.mutateAsync({
      blurPx: draftBlurPx,
      darkenOpacity: draftDarkenOpacity,
    })
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
                    onCheckedChange={(next) => toggleSplash.mutate(next)}
                    disabled={toggleSplash.isPending}
                  />
                  {toggleSplash.error ? (
                    <span
                      role="alert"
                      className="text-destructive max-w-48 text-right text-xs"
                    >
                      {errorMessage(
                        toggleSplash.error,
                        t("Couldn't update backdrop"),
                      )}
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
