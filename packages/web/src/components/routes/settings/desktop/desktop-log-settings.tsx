import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { FolderOpenIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "./desktop-native"

export function DesktopLogSettings() {
  const desktop = alloyDesktop()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!desktop?.openLogsFolder) return null
  const openLogsFolder = desktop.openLogsFolder

  async function openLogs() {
    setOpening(true)
    setError(null)
    try {
      await openLogsFolder()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Couldn't open the desktop logs folder."),
      )
    } finally {
      setOpening(false)
    }
  }

  return (
    <SettingRow
      title={t("Desktop logs")}
      description={
        <>
          {t("Host and recorder diagnostics are saved in alloy-desktop.log.")}
          {error ? (
            <span role="alert" className="text-destructive mt-1 block">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={opening}
        onClick={() => void openLogs()}
      >
        {opening ? <Spinner /> : <FolderOpenIcon className="size-3.5" />}
        {t("Open logs folder")}
      </Button>
    </SettingRow>
  )
}
