import { type AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { SaveIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

type AdminConfigSetter = Dispatch<SetStateAction<AdminRuntimeConfig | null>>

export function AppearanceSettingsContent({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: AdminConfigSetter
}) {
  const [enabledPending, setEnabledPending] = useState(false)
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
    setEnabledPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: { enabled: next },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(
        next ? t("Login backdrop enabled") : t("Login backdrop disabled"),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update backdrop")))
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
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("Login backdrop appearance saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save backdrop appearance")))
    } finally {
      setTreatmentPending(false)
    }
  }

  // The enabled switch applies immediately; only the blur/darkening treatment
  // is deferred, so that's what goes through the unified save bar.
  const inSettingsDialog = useSettingsSaveBar({
    dirty: treatmentChanged,
    saving: treatmentPending,
    save: saveTreatment,
    discard: cancelTreatment,
  })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-4">
        <div className="not-last:border-border flex items-start justify-between gap-4 py-3 not-last:border-b first:pt-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("Login backdrop")}</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {t(
                "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.",
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LoginAppearancePreview
              config={config}
              splash={previewSplash}
              blurPx={draftBlurPx}
              darkenOpacity={draftDarkenOpacity}
              controlsDisabled={treatmentPending}
              onBlurPxChange={setDraftBlurPx}
              onDarkenOpacityChange={setDraftDarkenOpacity}
            />
            <Switch
              checked={splash.enabled}
              onCheckedChange={updateSplashEnabled}
              disabled={enabledPending}
            />
          </div>
        </div>
      </SectionContent>
      {!inSettingsDialog && (
        <SectionFooter>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelTreatment}
              disabled={treatmentPending || !treatmentChanged}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={saveTreatment}
              disabled={treatmentPending || !treatmentChanged}
            >
              <SaveIcon />
              {treatmentPending ? t("Saving...") : t("Save")}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}
