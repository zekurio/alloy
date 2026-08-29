import { t } from "@alloy/i18n"
import {
  AppSidebarItem,
  AppSidebarItemTooltip,
} from "@alloy/ui/components/app-sidebar"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { cn } from "@alloy/ui/lib/utils"
import { CircleAlertIcon, DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"

/**
 * Device-local "update ready" control pinned in the nav rail's bottom cluster.
 * Icon-only to fit the rail; the state and version details live in a tooltip.
 * Renders nothing in a regular browser or until an update is available,
 * downloading, or ready to install.
 */
export function DesktopUpdatePill() {
  const { status, version } = useDesktopUpdateState()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)

  if (
    status !== "available" &&
    status !== "downloading" &&
    status !== "downloaded"
  ) {
    return null
  }

  const downloaded = status === "downloaded"
  const busy = status === "downloading" || pending

  const runAction = () => {
    if (busy) return
    const desktop = alloyDesktop()
    if (!desktop) return
    setError(null)

    if (status === "available") {
      setPending(true)
      void desktop.updates
        .downloadUpdate()
        .catch(() => setError(t("Couldn't download the update.")))
        .finally(() => setPending(false))
      return
    }

    if (!downloaded) return
    setRestartDialogOpen(true)
  }

  const restartToInstall = () => {
    if (pending) return
    const desktop = alloyDesktop()
    if (!desktop) return
    setError(null)
    setPending(true)
    void desktop.updates.restartToInstall().catch(() => {
      setError(t("Couldn't restart to update."))
      setPending(false)
    })
  }

  const label = error
    ? t("Try again")
    : pending
      ? downloaded
        ? t("Restarting…")
        : t("Starting download…")
      : downloaded
        ? t("Restart to update")
        : status === "available"
          ? t("Update available")
          : t("Downloading update")
  const detail =
    error ??
    (version
      ? status === "available"
        ? t("Alloy {version} is available to download.", { version })
        : t("Alloy {version} has been downloaded.", { version })
      : status === "available"
        ? t("A new version is available to download.")
        : t("A new version has been downloaded."))

  return (
    <>
      <AppSidebarItemTooltip
        className="flex-col items-start gap-0.5"
        label={
          <>
            <span className="font-medium">{label}</span>
            <span className="opacity-80">{detail}</span>
          </>
        }
        render={
          // aria-disabled (with a guarded click handler) instead of the
          // disabled attribute so the control keeps emitting hover events and
          // the tooltip still explains the downloading state.
          <AppSidebarItem
            type="button"
            aria-disabled={busy || undefined}
            onClick={runAction}
            aria-label={busy ? label : detail}
            className={cn(
              "text-accent bg-accent/12",
              busy
                ? "cursor-default opacity-80"
                : "cursor-pointer hover:bg-accent/20",
            )}
          >
            {error ? (
              <CircleAlertIcon className="text-destructive" />
            ) : downloaded ? (
              <RefreshCwIcon />
            ) : (
              <DownloadIcon />
            )}
          </AppSidebarItem>
        }
      />
      <ConfirmActionDialog
        open={restartDialogOpen}
        onOpenChange={(open) => {
          setRestartDialogOpen(open)
          if (!open) setError(null)
        }}
        title={t("Install the update and restart Alloy?")}
        description={t(
          "Recording will stop while the desktop update is installed.",
        )}
        confirmLabel={t("Install and restart")}
        pendingLabel={t("Installing...")}
        pending={pending}
        error={error}
        onConfirm={restartToInstall}
      />
    </>
  )
}
