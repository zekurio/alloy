import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import { DownloadIcon, RefreshCcwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"
import { errorMessage } from "@/lib/error-message"

type UpdateAction = "checking" | "downloading" | "installing"

const ACTION_FAILURES = {
  checking: t("Couldn't check for updates."),
  downloading: t("Couldn't download the update."),
  installing: t("Couldn't restart to update."),
} satisfies Record<UpdateAction, string>

export function DesktopUpdateSettings() {
  const desktop = alloyDesktop()
  const updateState = useDesktopUpdateState()
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  // Resolves to the confirmation shown on the check button, if any.
  const action = useMutation({
    networkMode: "always",
    mutationFn: async (next: UpdateAction): Promise<string | null> => {
      if (!desktop) return null
      const updates = desktop.updates
      if (next === "installing") {
        await updates.restartToInstall()
        return null
      }
      if (next === "downloading") {
        await updates.downloadUpdate()
        return null
      }
      const state = await updates.checkForUpdates()
      return state.status === "idle" ? t("No updates found.") : null
    },
  })

  if (!desktop) return null

  // A successful install restarts the app, so it stays "installing".
  const phase: UpdateAction | "idle" = action.isPending
    ? action.variables
    : action.isSuccess && action.variables === "installing"
      ? "installing"
      : "idle"
  const actionError =
    action.isError && action.variables
      ? errorMessage(action.error, ACTION_FAILURES[action.variables])
      : null
  const actionSuccess = action.data ?? null
  const checkBusy = phase === "checking" || updateState.status === "checking"
  const downloadBusy =
    phase === "downloading" || updateState.status === "downloading"
  const checkDisabled =
    !updateState.supported ||
    phase !== "idle" ||
    (updateState.status !== "idle" && updateState.status !== "available")

  return (
    <SettingRow
      title={t("Updates")}
      description={
        !updateState.supported
          ? t("Automatic updates are unavailable in this build.")
          : t("Check for and install desktop app updates.")
      }
      footer={
        actionError ? (
          <p role="alert" className="text-destructive text-xs">
            {actionError}
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
          onClick={() => action.mutate("downloading")}
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
          onClick={() => action.mutate("checking")}
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
              {actionSuccess ?? t("Check for updates")}
            </>
          )}
        </Button>
      )}
      <ConfirmActionDialog
        open={restartDialogOpen}
        onOpenChange={(open) => {
          setRestartDialogOpen(open)
          if (!open && action.isError) action.reset()
        }}
        title={t("Install the update and restart Alloy?")}
        description={t(
          "Recording will stop while the desktop update is installed.",
        )}
        confirmLabel={t("Install and restart")}
        pendingLabel={t("Installing...")}
        pending={phase === "installing"}
        error={actionError}
        onConfirm={() => action.mutate("installing")}
      />
    </SettingRow>
  )
}
