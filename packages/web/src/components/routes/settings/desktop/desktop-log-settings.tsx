import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { FolderOpenIcon } from "lucide-react"

import { alloyDesktop } from "@/lib/desktop"
import { useActionFeedback } from "@/lib/use-action-feedback"

export function DesktopLogSettings() {
  const desktop = alloyDesktop()
  const { feedback, run } = useActionFeedback()

  if (!desktop) return null
  const openLogsFolder = desktop.openLogsFolder
  const opening = feedback.state === "pending"

  return (
    <SettingRow
      title={t("Desktop logs")}
      description={
        <>
          {t("Host and recorder diagnostics are saved in alloy-desktop.log.")}
          {feedback.state === "error" ? (
            <span role="alert" className="text-destructive mt-1 block">
              {feedback.message}
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
        onClick={() =>
          void run(openLogsFolder, t("Couldn't open the desktop logs folder."))
        }
      >
        {opening ? <Spinner /> : <FolderOpenIcon className="size-3.5" />}
        {t("Open logs folder")}
      </Button>
    </SettingRow>
  )
}
