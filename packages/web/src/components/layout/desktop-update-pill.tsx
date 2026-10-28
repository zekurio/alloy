import { t } from "@alloy/i18n"
import {
  AppSidebarItem,
  AppSidebarItemTooltip,
} from "@alloy/ui/components/app-sidebar"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { cn } from "@alloy/ui/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { CircleAlertIcon, DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import {
  updateDownloadPercent,
  useDesktopUpdateState,
} from "@/lib/desktop-updates"

/** Where a user reinstalls when an update fails its signature check. */
const RELEASES_URL = "https://github.com/zekurio/alloy/releases/latest"

/**
 * A ring around the rail icon that fills as the update downloads. The item's
 * own styles size every icon in it, so the ring sets its size inline.
 */
function DownloadProgressRing({ percent }: { percent: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -rotate-90"
      style={{ width: "100%", height: "100%" }}
    >
      <circle
        cx="20"
        cy="20"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-25"
      />
      <circle
        cx="20"
        cy="20"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100"
        strokeDashoffset={100 - percent}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  )
}

/**
 * Device-local "update ready" control pinned in the nav rail's bottom cluster.
 * The rail shows an icon, ringed with the download's progress while it
 * downloads. Its tooltip shows the current update state. An update that
 * failed its signature check turns it into a link to the releases page.
 * Renders nothing in a regular browser or until an update is available,
 * downloading, or ready to install.
 */
export function DesktopUpdatePill() {
  const updateState = useDesktopUpdateState()
  const { status } = updateState
  const percent = updateDownloadPercent(updateState)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  const action = useMutation({
    // Bridge calls: the browser's offline flag must not pause them.
    networkMode: "always",
    mutationFn: async (next: "download" | "restart") => {
      const desktop = alloyDesktop()
      if (!desktop) return
      if (next === "download") await desktop.updates.downloadUpdate()
      else await desktop.updates.restartToInstall()
    },
  })

  if (
    status !== "available" &&
    status !== "downloading" &&
    status !== "downloaded"
  ) {
    return null
  }

  if (status === "available" && updateState.error === "unverified") {
    const message = t(
      "The update couldn't be verified. Reinstall Alloy from the releases page.",
    )
    return (
      <AppSidebarItemTooltip
        label={message}
        render={
          // Opens in the user's browser, like every link off the server.
          <AppSidebarItem
            render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
            aria-label={message}
            className="text-accent bg-accent/12 hover:bg-accent/20 cursor-pointer"
          >
            <CircleAlertIcon className="text-destructive" />
          </AppSidebarItem>
        }
      />
    )
  }

  const downloaded = status === "downloaded"
  // A successful restart call leaves the app quitting, so it stays pending.
  const pending =
    action.isPending || (action.isSuccess && action.variables === "restart")
  const error = action.isError
    ? action.variables === "restart"
      ? t("Couldn't restart to update.")
      : t("Couldn't download the update.")
    : null
  const busy = status === "downloading" || pending

  const runAction = () => {
    if (busy || !alloyDesktop()) return
    if (status === "available") {
      action.mutate("download")
      return
    }
    if (!downloaded) return
    action.reset()
    setRestartDialogOpen(true)
  }

  const restartToInstall = () => {
    if (pending || !alloyDesktop()) return
    action.mutate("restart")
  }

  const label = error
    ? error
    : pending
      ? downloaded
        ? t("Restarting…")
        : t("Starting download…")
      : downloaded
        ? t("Restart to update")
        : status === "available"
          ? t("Update available")
          : percent === null
            ? t("Downloading update")
            : t("Downloading {progress}%", { progress: percent })

  return (
    <>
      <AppSidebarItemTooltip
        label={label}
        render={
          // aria-disabled (with a guarded click handler) instead of the
          // disabled attribute so the control keeps emitting hover events and
          // the tooltip still explains the downloading state.
          <AppSidebarItem
            type="button"
            aria-disabled={busy || undefined}
            onClick={runAction}
            aria-label={label}
            className={cn(
              "text-accent bg-accent/12",
              busy
                ? "cursor-default opacity-80"
                : "cursor-pointer hover:bg-accent/20",
            )}
          >
            {percent !== null && !error ? (
              <DownloadProgressRing percent={percent} />
            ) : null}
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
          if (!open && action.isError) action.reset()
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
