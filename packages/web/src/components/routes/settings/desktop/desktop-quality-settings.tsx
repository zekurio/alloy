import { Spinner } from "alloy-ui/components/spinner"

import { EncodingSettingsGrid } from "./desktop-capture-encoding"
import { QualitySection, ReplayBufferSection } from "./desktop-capture-quality"
import { Subsection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"

export function DesktopQualitySettings() {
  const { settings, status, busy, setSettings, save } = useDesktopRecording()

  if (!settings || !status) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        Loading quality settings
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <QualitySection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <Subsection title="Encoding">
        <EncodingSettingsGrid
          settings={settings}
          status={status}
          busy={busy}
          save={save}
        />
      </Subsection>

      <hr className="border-border" />

      <ReplayBufferSection
        settings={settings}
        busy={busy}
        setSettings={setSettings}
        save={save}
      />
    </div>
  )
}
