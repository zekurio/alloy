import { Spinner } from "alloy-ui/components/spinner"

import { EncodingSettingsGrid } from "@/components/routes/settings/desktop-capture-encoding"
import { HotkeysSection } from "@/components/routes/settings/desktop-capture-hotkeys"
import {
  QualitySection,
  ReplayBufferSection,
} from "@/components/routes/settings/desktop-capture-quality"
import {
  ModeSection,
  Subsection,
} from "@/components/routes/settings/desktop-capture-sections"
import { useDesktopRecording } from "@/components/routes/settings/desktop-recording-context"
import { DesktopStorageSettings } from "@/components/routes/settings/desktop-storage-settings"

export function DesktopCaptureSettings() {
  const { settings, status, busy, setSettings, save } = useDesktopRecording()

  if (!settings || !status) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        Loading capture settings
      </div>
    )
  }

  const backendReady = status.backend === "ready"
  const recordingActive = status.mode !== "idle"
  const settingsDisabled = busy || !backendReady || recordingActive
  const captureToggleDisabled = busy || recordingActive

  return (
    <div className="flex flex-col gap-6">
      <ModeSection
        settings={settings}
        status={status}
        busy={captureToggleDisabled}
        save={save}
      />

      <hr className="border-border" />

      <QualitySection settings={settings} busy={settingsDisabled} save={save} />

      <hr className="border-border" />

      <EncodingSettingsGrid
        settings={settings}
        status={status}
        busy={settingsDisabled}
        save={save}
      />

      <hr className="border-border" />

      {settings.triggerMode === "replay-buffer" ? (
        <>
          <ReplayBufferSection
            settings={settings}
            busy={settingsDisabled}
            setSettings={setSettings}
            save={save}
          />

          <hr className="border-border" />
        </>
      ) : null}

      <HotkeysSection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <Subsection title="Storage">
        <DesktopStorageSettings />
      </Subsection>
    </div>
  )
}
