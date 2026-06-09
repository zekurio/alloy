import { Spinner } from "alloy-ui/components/spinner"

import { EncodingSettingsGrid } from "./desktop-capture-encoding"
import { AllowedGamesSection } from "./desktop-capture-games"
import { HotkeysSection } from "./desktop-capture-hotkeys"
import { NotificationSoundsSection } from "./desktop-capture-notifications"
import { QualitySection, ReplayBufferSection } from "./desktop-capture-quality"
import { ModeSection, Subsection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"
import { DesktopStorageSettings } from "./desktop-storage-settings"

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

  return (
    <div className="flex flex-col gap-6">
      <ModeSection
        settings={settings}
        status={status}
        busy={busy}
        save={save}
      />

      <hr className="border-border" />

      <Subsection title="Games">
        <AllowedGamesSection settings={settings} busy={busy} save={save} />
      </Subsection>

      <hr className="border-border" />

      <QualitySection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <EncodingSettingsGrid
        settings={settings}
        status={status}
        busy={busy}
        save={save}
      />

      <hr className="border-border" />

      {settings.triggerMode === "replay-buffer" ? (
        <>
          <ReplayBufferSection
            settings={settings}
            busy={busy}
            setSettings={setSettings}
            save={save}
          />

          <hr className="border-border" />
        </>
      ) : null}

      <HotkeysSection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <NotificationSoundsSection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <Subsection title="Storage">
        <DesktopStorageSettings />
      </Subsection>
    </div>
  )
}
