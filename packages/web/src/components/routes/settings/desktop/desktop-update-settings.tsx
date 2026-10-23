import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { DownloadIcon, RefreshCcwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"
import { errorMessage } from "@/lib/error-message"

type Phase = "idle" | "checking" | "downloading" | "installing"

export function DesktopUpdateSettings() {
  const desktop = alloyDesktop()
  const updateState = useDesktopUpdateState()
  const [phase, setPhase] = useState<Phase>("idle")
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  const [actionMessage, setActionMessage] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)

  if (!desktop) return null
  const updates = desktop.updates

  const checkBusy = phase === "checking" || updateState.status === "checking"
  const downloadBusy =
    phase === "downloading" || updateState.status === "downloading"
  const checkDisabled =
    !updateState.supported ||
    phase !== "idle" ||
    (updateState.status !== "idle" && updateState.status !== "available")

  async function runAction(
    next: Exclude<Phase, "idle">,
    action: () => Promise<void>,
    fallbackError: string,
  ) {
    setActionMessage(null)
    setPhase(next)
    try {
      await action()
      // A successful install restarts the app, so it stays "installing".
      if (next !== "installing") setPhase("idle")
    } catch (cause) {
      setActionMessage({
        tone: "error",
        text: errorMessage(cause, fallbackError),
      })
      setPhase("idle")
    }
  }

  const restartToInstall = () =>
    runAction(
      "installing",
      () => updates.restartToInstall(),
      t("Couldn't restart to update."),
    )
  const downloadUpdate = () =>
    runAction(
      "downloading",
      async () => {
        await updates.downloadUpdate()
      },
      t("Couldn't download the update."),
    )
  const checkForUpdates = () =>
    runAction(
      "checking",
      async () => {
        const state = await updates.checkForUpdates()
        if (state.status === "idle") {
          setActionMessage({ tone: "success", text: t("No updates found.") })
        }
      },
      t("Couldn't check for updates."),
    )

  return (
    <SettingRow
      title={t("Updates")}
      description={
        !updateState.supported
          ? t("Automatic updates are unavailable in this build.")
          : t("Check for and install desktop app updates.")
      }
      footer={
        actionMessage?.tone === "error" ? (
          <p role="alert" className="text-destructive text-xs">
            {actionMessage.text}
          </p>
        ) : null
      }
    >
      {updateState.status === "downloaded" ? (
        <Button
          type="button"
          size="sm"
          disabled={phase === "installing"}
          aria-busy={phase === "installing"}
          onClick={() => setRestartDialogOpen(true)}
        >
          {phase === "installing" ? (
            <>
              <Spinner />
              {t("Installing...")}
            </>
          ) : (
            <>
              <RefreshCcwIcon className="size-3.5" />
              {t("Install and restart")}
            </>
          )}
        </Button>
      ) : updateState.status === "available" ? (
        <Button
          type="button"
          size="sm"
          disabled={phase !== "idle"}
          aria-busy={downloadBusy}
          onClick={() => void downloadUpdate()}
        >
          {downloadBusy ? (
            <>
              <Spinner />
              {t("Downloading...")}
            </>
          ) : (
            <>
              <DownloadIcon className="size-3.5" />
              {t("Download update")}
            </>
          )}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={checkDisabled}
          aria-busy={checkBusy || downloadBusy}
          aria-live="polite"
          onClick={() => void checkForUpdates()}
        >
          {checkBusy ? (
            <>
              <Spinner />
              {t("Checking...")}
            </>
          ) : updateState.status === "downloading" ? (
            <>
              <Spinner />
              {t("Downloading...")}
            </>
          ) : (
            <>
              <SearchIcon className="size-3.5" />
              {actionMessage?.tone === "success"
                ? actionMessage.text
                : t("Check for updates")}
            </>
          )}
        </Button>
      )}
      <ConfirmActionDialog
        open={restartDialogOpen}
        onOpenChange={(open) => {
          setRestartDialogOpen(open)
          if (!open && actionMessage?.tone === "error") setActionMessage(null)
        }}
        title={t("Install the update and restart Alloy?")}
        description={t(
          "Recording will stop while the desktop update is installed.",
        )}
        confirmLabel={t("Install and restart")}
        pendingLabel={t("Installing...")}
        pending={phase === "installing"}
        error={actionMessage?.tone === "error" ? actionMessage.text : null}
        onConfirm={() => void restartToInstall()}
      />
    </SettingRow>
  )
}
