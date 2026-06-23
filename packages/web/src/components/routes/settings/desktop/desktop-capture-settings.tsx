import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { RefreshCcwIcon } from "lucide-react"
import { useState } from "react"

import { AllowedGamesSection } from "./desktop-capture-games"
import { HotkeysSection } from "./desktop-capture-hotkeys"
import { NotificationSoundsSection } from "./desktop-capture-notifications"
import { ModeSection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"
import { DesktopStorageSettings } from "./desktop-storage-settings"

export function DesktopCaptureSettings() {
  const { settings, status, busy, save, restartBackend } = useDesktopRecording()
  const [restarting, setRestarting] = useState(false)

  if (!settings || !status) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        {t("Loading capture settings")}
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

      <SettingRow
        title={t("Recording sidecar")}
        description={t(
          "Restart the capture component if recording gets stuck.",
        )}
        className="border-b-0!"
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || restarting}
          onClick={() => {
            setRestarting(true)
            void restartBackend().finally(() => setRestarting(false))
          }}
        >
          {restarting ? (
            <>
              <Spinner />
              {t("Restarting...")}
            </>
          ) : (
            <>
              <RefreshCcwIcon className="size-3.5" />
              {t("Restart")}
            </>
          )}
        </Button>
      </SettingRow>

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
        {t("Loading storage settings")}
      </div>
    )
  }

  return <DesktopStorageSettings />
}
