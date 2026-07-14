import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"

/**
 * Device-local "update ready" pill pinned in the nav rail footer, just above
 * the user menu. Renders nothing in a regular browser or until an update is
 * available, downloading, or ready to install.
 */
export function DesktopUpdatePill() {
  const { status, version } = useDesktopUpdateState()
  const [pending, setPending] = useState(false)

  if (
    status !== "available" &&
    status !== "downloading" &&
    status !== "downloaded"
  ) {
    return null
  }

  const downloaded = status === "downloaded"

  const runAction = () => {
    const updates = alloyDesktop()?.updates
    if (!updates) return

    if (status === "available") {
      if (!updates.downloadUpdate) return
      setPending(true)
      void updates
        .downloadUpdate()
        .catch(() => toast.error(t("Couldn't download the update.")))
        .finally(() => setPending(false))
      return
    }

    if (!downloaded) return
    setPending(true)
    void updates.restartToInstall().catch(() => {
      toast.error(t("Couldn't restart to update."))
      setPending(false)
    })
  }

  const label = pending
    ? downloaded
      ? t("Restarting…")
      : t("Starting download…")
    : downloaded
      ? t("Restart to update")
      : status === "available"
        ? t("Update available")
        : t("Downloading update")
  const tooltip = version
    ? status === "available"
      ? t("Alloy {version} is available to download.", { version })
      : t("Alloy {version} has been downloaded.", { version })
    : status === "available"
      ? t("A new version is available to download.")
      : t("A new version has been downloaded.")

  return (
    <button
      type="button"
      disabled={status === "downloading" || pending}
      onClick={runAction}
      aria-label={status === "downloading" ? label : tooltip}
      title={status === "downloading" ? undefined : tooltip}
      className={cn(
        "mb-1.5 flex h-8 w-full items-center gap-2 rounded-md px-2.5",
        "text-accent bg-accent/12 text-xs font-medium",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        status !== "downloading"
          ? "cursor-pointer hover:bg-accent/20"
          : "cursor-default opacity-80",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
      )}
    >
      {downloaded ? <RefreshCwIcon /> : <DownloadIcon />}
      <span className="truncate">{label}</span>
    </button>
  )
}
