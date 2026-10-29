import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useForm, useStore } from "@tanstack/react-form"
import { useMemo } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { AdminAccentSettings } from "@/components/routes/settings/admin-accent-settings"
import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { ResetToDefaultButton } from "@/components/routes/settings/admin-reset-default"
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
  const defaultSplash = config.defaults.appearance.loginSplash
  // The enabled switch applies immediately; only the blur/darkening treatment
  // is deferred, so that's what goes through the unified save bar.
  const form = useForm({
    defaultValues: {
      blurPx: splash.blurPx,
      darkenOpacity: splash.darkenOpacity,
    },
    onSubmit: async ({ value, formApi }) => {
      const updated = await saveSplashTreatment.mutateAsync(value)
      const { blurPx, darkenOpacity } = updated.appearance.loginSplash
      formApi.reset({ blurPx, darkenOpacity }, { keepDefaultValues: true })
    },
  })
  const treatment = useStore(form.store, (state) => state.values)
  const previewSplash = useMemo(
    () => ({ ...splash, ...treatment }),
    [splash, treatment],
  )

  useSettingsSaveBar(form, {
    dirty:
      treatment.blurPx !== splash.blurPx ||
      treatment.darkenOpacity !== splash.darkenOpacity,
    saving: treatmentPending,
  })

  return (
    <Section>
      <SectionContent className="py-0">
        <SettingsSections>
          <AdminAccentSettings config={config} />
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
              blurPx={treatment.blurPx}
              darkenOpacity={treatment.darkenOpacity}
              blurReset={
                <ResetToDefaultButton
                  value={treatment.blurPx}
                  defaultValue={defaultSplash.blurPx}
                  label={`${defaultSplash.blurPx}${t("px")}`}
                  disabled={treatmentPending}
                  onReset={() =>
                    form.setFieldValue("blurPx", defaultSplash.blurPx)
                  }
                  className="-my-1"
                />
              }
              darkenReset={
                <ResetToDefaultButton
                  value={treatment.darkenOpacity}
                  defaultValue={defaultSplash.darkenOpacity}
                  label={`${Math.round(defaultSplash.darkenOpacity * 100)}%`}
                  disabled={treatmentPending}
                  onReset={() =>
                    form.setFieldValue(
                      "darkenOpacity",
                      defaultSplash.darkenOpacity,
                    )
                  }
                  className="-my-1"
                />
              }
              controlsDisabled={treatmentPending}
              onBlurPxChange={(value) => form.setFieldValue("blurPx", value)}
              onDarkenOpacityChange={(value) =>
                form.setFieldValue("darkenOpacity", value)
              }
            />
          </SettingsSubsection>
        </SettingsSections>
      </SectionContent>
    </Section>
  )
}
