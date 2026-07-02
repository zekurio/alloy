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
import { RefreshCwIcon, SaveIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

type AdminConfigSetter = Dispatch<SetStateAction<AdminRuntimeConfig | null>>

const RENDITION_TIER_OPTIONS = [
  {
    key: "enable1080p",
    label: t("1080p60"),
    description: t("Full HD at up to 60 fps. The largest files, best quality."),
  },
  {
    key: "enable720p",
    label: t("720p60"),
    description: t("HD at up to 60 fps. The adaptive-streaming middle tier."),
  },
  {
    key: "enable480p",
    label: t("480p30"),
    description: t(
      "Low bandwidth tier, also used for hover previews in clip grids.",
    ),
  },
] as const

export function TranscodingSettingsContent({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: AdminConfigSetter
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [reEncodePending, setReEncodePending] = useState(false)
  const transcoding = config.transcoding
  const enabledCount = RENDITION_TIER_OPTIONS.filter(
    (tier) => transcoding[tier.key],
  ).length

  async function updateTier(
    key: (typeof RENDITION_TIER_OPTIONS)[number]["key"],
    next: boolean,
  ) {
    if (pendingKey) return
    setPendingKey(key)
    try {
      const updated = await api.admin.updateTranscodingConfig({ [key]: next })
      setConfig(updated)
      toast.success(t("Rendition settings saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update rendition settings")))
    } finally {
      setPendingKey(null)
    }
  }

  async function reEncodeAll() {
    if (reEncodePending) return
    setReEncodePending(true)
    try {
      const result = await api.admin.reEncodeAllClips()
      toast.success(
        result.hasMore
          ? t("Re-encode started for {count} clips; run again for the rest.", {
              count: result.enqueued,
            })
          : t("Re-encode started for {count} clips.", {
              count: result.enqueued,
            }),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't start re-encode")))
    } finally {
      setReEncodePending(false)
    }
  }

  return (
    <Section>
      <SectionContent className="flex flex-col gap-4 py-0">
        <p className="text-foreground-dim text-xs">
          {t(
            "Quality tiers encoded for every new upload. Tiers above the source resolution are skipped automatically; the highest tier also powers link embeds, so at least one must stay enabled.",
          )}
        </p>
        {RENDITION_TIER_OPTIONS.map((tier) => (
          <div
            key={tier.key}
            className="flex items-start justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{tier.label}</div>
              <p className="text-foreground-dim mt-0.5 text-xs">
                {tier.description}
              </p>
            </div>
            <Switch
              checked={transcoding[tier.key]}
              onCheckedChange={(next) => updateTier(tier.key, next)}
              disabled={
                pendingKey !== null ||
                (transcoding[tier.key] && enabledCount === 1)
              }
              className="shrink-0"
            />
          </div>
        ))}
      </SectionContent>
      <SectionFooter>
        <div className="flex w-full items-start justify-between gap-4">
          <p className="text-foreground-dim text-xs">
            {t(
              "Changes apply to new uploads. Re-encode existing clips to regenerate their renditions with the current tiers.",
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reEncodeAll}
            disabled={reEncodePending}
            className="shrink-0"
          >
            <RefreshCwIcon />
            {reEncodePending ? t("Starting...") : t("Re-encode clips")}
          </Button>
        </div>
      </SectionFooter>
    </Section>
  )
}

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
      <SectionContent className="flex flex-col gap-4 py-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("Login backdrop")}</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {t(
                "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.",
              )}
            </p>
          </div>
          <Switch
            checked={splash.enabled}
            onCheckedChange={updateSplashEnabled}
            disabled={enabledPending}
            className="shrink-0"
          />
        </div>

        <LoginAppearancePreview
          config={config}
          splash={previewSplash}
          blurPx={draftBlurPx}
          darkenOpacity={draftDarkenOpacity}
          controlsDisabled={treatmentPending}
          onBlurPxChange={setDraftBlurPx}
          onDarkenOpacityChange={setDraftDarkenOpacity}
        />
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
