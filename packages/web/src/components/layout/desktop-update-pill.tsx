import { t } from "@alloy/i18n"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
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

    if (status === "available") {
      setPending(true)
      void desktop.updates
        .downloadUpdate()
        .catch(() => toast.error(t("Couldn't download the update.")))
        .finally(() => setPending(false))
      return
    }

    if (!downloaded) return
    setPending(true)
    void desktop.updates.restartToInstall().catch(() => {
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
  const detail = version
    ? status === "available"
      ? t("Alloy {version} is available to download.", { version })
      : t("Alloy {version} has been downloaded.", { version })
    : status === "available"
      ? t("A new version is available to download.")
      : t("A new version has been downloaded.")

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // aria-disabled (with a guarded click handler) instead of the
          // disabled attribute so the control keeps emitting hover events and
          // the tooltip still explains the downloading state.
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={runAction}
            aria-label={busy ? label : detail}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-md",
              "text-accent bg-accent/12",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              busy
                ? "cursor-default opacity-80"
                : "cursor-pointer hover:bg-accent/20",
              "[&_svg]:size-5 [&_svg]:shrink-0",
            )}
          >
            {downloaded ? <RefreshCwIcon /> : <DownloadIcon />}
          </button>
        }
      />
      <TooltipContent side="right" className="flex-col items-start gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="opacity-80">{detail}</span>
      </TooltipContent>
    </Tooltip>
  )
}
