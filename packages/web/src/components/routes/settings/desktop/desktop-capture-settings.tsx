import { Spinner } from "@alloy/ui/components/spinner"

import { AllowedGamesSection } from "./desktop-capture-games"
import { HotkeysSection } from "./desktop-capture-hotkeys"
import { NotificationSoundsSection } from "./desktop-capture-notifications"
import { ModeSection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"
import { DesktopStorageSettings } from "./desktop-storage-settings"

export function DesktopCaptureSettings() {
  const { settings, status, busy, save } = useDesktopRecording()

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

      <AllowedGamesSection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <HotkeysSection settings={settings} busy={busy} save={save} />

      <hr className="border-border" />

      <NotificationSoundsSection settings={settings} busy={busy} save={save} />
    </div>
  )
}

export function DesktopStoragePanel() {
  const { settings, storageInfo } = useDesktopRecording()

  if (!settings || !storageInfo) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        Loading storage settings
      </div>
    )
  }

  return <DesktopStorageSettings />
}
