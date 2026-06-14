import { type AdminRuntimeConfig } from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import { Slider } from "@alloy/ui/components/slider"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { DownloadIcon, SaveIcon, UploadIcon } from "lucide-react"
import * as React from "react"

import { LoginAppearancePreview } from "@/components/routes/admin-settings/login-appearance-preview"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"
import { startBlobDownload } from "@/lib/browser-download"
import { isoDateStamp } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

type AdminConfigSetter = React.Dispatch<
  React.SetStateAction<AdminRuntimeConfig | null>
>

export function AppearanceSettingsContent({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: AdminConfigSetter
}) {
  const [pending, setPending] = React.useState(false)
  const splash = config.appearance.loginSplash
  const [draftBlurPx, setDraftBlurPx] = React.useState(splash.blurPx)
  const [draftDarkenOpacity, setDraftDarkenOpacity] = React.useState(
    splash.darkenOpacity,
  )
  const previewSplash = React.useMemo(
    () => ({
      ...splash,
      blurPx: draftBlurPx,
      darkenOpacity: draftDarkenOpacity,
    }),
    [draftBlurPx, draftDarkenOpacity, splash],
  )
  const treatmentChanged =
    draftBlurPx !== splash.blurPx || draftDarkenOpacity !== splash.darkenOpacity

  function sliderValue(value: number | readonly number[]): number {
    return typeof value === "number" ? value : (value[0] ?? 0)
  }

  React.useEffect(() => {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }, [splash.blurPx, splash.darkenOpacity])

  async function updateSplashEnabled(next: boolean) {
    if (pending) return
    setPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: { enabled: next },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(next ? "Login backdrop enabled" : "Login backdrop disabled")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update backdrop"))
    } finally {
      setPending(false)
    }
  }

  function cancelTreatment() {
    setDraftBlurPx(splash.blurPx)
    setDraftDarkenOpacity(splash.darkenOpacity)
  }

  async function saveTreatment() {
    if (pending || !treatmentChanged) return
    setPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: {
          blurPx: draftBlurPx,
          darkenOpacity: draftDarkenOpacity,
        },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success("Login backdrop appearance saved")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't save backdrop appearance"))
    } finally {
      setPending(false)
    }
  }

  // The enabled switch applies immediately; only the blur/darkening treatment
  // is deferred, so that's what goes through the unified save bar.
  const inSettingsDialog = useSettingsSaveBar({
    dirty: treatmentChanged,
    saving: pending,
    save: saveTreatment,
    discard: cancelTreatment,
  })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-4">
        <LoginAppearancePreview config={config} splash={previewSplash} />
        <div className="not-last:border-border flex items-start justify-between gap-4 py-3 not-last:border-b first:pt-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">Login backdrop</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              Show a sloped, scrolling wall of random public clip thumbnails
              behind the login form.
            </p>
          </div>
          <Switch
            checked={splash.enabled}
            onCheckedChange={updateSplashEnabled}
            disabled={pending}
          />
        </div>
        <div className="grid gap-4 py-3 last:pb-0 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm font-medium">
              <span>Blur</span>
              <span className="text-foreground-muted text-xs">
                {draftBlurPx}px
              </span>
            </div>
            <Slider
              value={[draftBlurPx]}
              min={0}
              max={48}
              step={1}
              disabled={pending}
              onValueChange={(value) => setDraftBlurPx(sliderValue(value))}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm font-medium">
              <span>Darkening</span>
              <span className="text-foreground-muted text-xs">
                {Math.round(draftDarkenOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={[draftDarkenOpacity]}
              min={0}
              max={1}
              step={0.01}
              disabled={pending}
              onValueChange={(value) =>
                setDraftDarkenOpacity(sliderValue(value))
              }
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
              disabled={pending || !treatmentChanged}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={saveTreatment}
              disabled={pending || !treatmentChanged}
            >
              <SaveIcon />
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}

export function ConfigTransferContent({
  setConfig,
}: {
  setConfig: AdminConfigSetter
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = React.useState(false)
  const [importing, setImporting] = React.useState(false)

  async function onExport() {
    setExporting(true)
    try {
      const data = await api.admin.exportRuntimeConfig()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const started = startBlobDownload(
        blob,
        `alloy-config-${isoDateStamp()}.json`,
      )
      if (!started) throw new Error("Export download failed")
      toast.success("Configuration exported")
    } catch (cause) {
      toast.error(errorMessage(cause, "Export failed"))
    } finally {
      setExporting(false)
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setImporting(true)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error("Selected file is not valid JSON")
      }
      const updated = await api.admin.importRuntimeConfig(parsed)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      setConfig(updated)
      toast.success("Configuration imported")
    } catch (cause) {
      toast.error(errorMessage(cause, "Import failed"))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="border-border flex items-start justify-between gap-4 border-b py-3 first:pt-0">
        <div className="min-w-0">
          <div className="text-sm font-medium">Export</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Download the current server configuration. Secrets are not included.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={exporting}
        >
          <DownloadIcon />
          {exporting ? "Exporting..." : "Export"}
        </Button>
      </div>
      <div className="flex items-start justify-between gap-4 py-3 last:pb-0">
        <div className="min-w-0">
          <div className="text-sm font-medium">Import</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Replace the current configuration from a previously exported JSON
            file.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          <UploadIcon />
          {importing ? "Importing..." : "Import"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onFileSelected}
        />
      </div>
    </div>
  )
}
