import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"

/**
 * Device-local "update ready" pill pinned in the nav rail footer, just above
 * the user menu. Renders nothing in a regular browser or until an update is
 * downloading/downloaded.
 */
export function DesktopUpdatePill() {
  const { status, version } = useDesktopUpdateState()
  const [pending, setPending] = useState(false)

  if (status !== "downloading" && status !== "downloaded") return null

  const downloaded = status === "downloaded"

  const restart = () => {
    const updates = alloyDesktop()?.updates
    if (!updates) return
    setPending(true)
    void updates.restartToInstall().catch(() => {
      setPending(false)
    })
  }

  const label = pending
    ? t("Restarting…")
    : downloaded
      ? t("Restart to update")
      : t("Downloading update")

  const tooltip = version
    ? t("Alloy {version} has been downloaded.", { version })
    : t("A new version has been downloaded.")

  return (
    <button
      type="button"
      disabled={!downloaded || pending}
      onClick={restart}
      aria-label={downloaded ? tooltip : label}
      title={downloaded ? tooltip : undefined}
      className={cn(
        "mb-1.5 flex h-8 w-full items-center gap-2 rounded-md px-2.5",
        "text-accent bg-accent/12 text-xs font-medium",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        downloaded
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
