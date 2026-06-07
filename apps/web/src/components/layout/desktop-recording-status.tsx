import type { RecordingSettings, RecordingStatus } from "alloy-contracts"
import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import {
  AlertTriangleIcon,
  ClapperboardIcon,
  Gamepad2Icon,
  PauseCircleIcon,
  RotateCcwIcon,
} from "lucide-react"

import { useDesktopRecording } from "@/components/routes/settings/desktop-recording-context"
import { alloyDesktop } from "@/lib/desktop"

export function DesktopRecordingStatus() {
  const desktop = alloyDesktop()
  const { settings, status } = useDesktopRecording()

  if (!desktop) return null

  if (!settings || !status) {
    return (
      <div className="border-border bg-surface-raised text-foreground-muted hidden h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold md:flex">
        <Spinner />
        Recorder
      </div>
    )
  }

  const summary = recordingSummary(settings, status)

  return (
    <div className="hidden min-w-0 items-center gap-1 md:flex">
      <div
        className={cn(
          "border-border bg-surface-raised hidden h-8 min-w-0 max-w-52 items-center gap-2 rounded-md border px-2.5 text-sm font-semibold md:flex",
          summary.tone === "active" && "border-accent-border bg-accent-soft",
          summary.tone === "warning" &&
            "border-[oklch(0.82_0.18_90/0.35)] bg-[oklch(0.82_0.18_90/0.1)]",
          summary.tone === "error" &&
            "border-[oklch(0.65_0.24_25/0.4)] bg-[oklch(0.65_0.24_25/0.12)]",
        )}
      >
        <summary.Icon
          className={cn("size-4 shrink-0", summary.iconClassName)}
        />
        <span className="truncate">{summary.label}</span>
      </div>
    </div>
  )
}

function recordingSummary(
  settings: RecordingSettings,
  status: RecordingStatus,
) {
  if (!settings.enabled) {
    return {
      label: "Recording Off",
      tone: "idle" as const,
      Icon: Gamepad2Icon,
      iconClassName: "text-foreground-muted",
    }
  }

  if (status.backend !== "ready") {
    return {
      label: "Recorder Offline",
      tone: "warning" as const,
      Icon: AlertTriangleIcon,
      iconClassName: "text-warning",
    }
  }

  if (status.runState === "error") {
    return {
      label: "Recorder Error",
      tone: "error" as const,
      Icon: AlertTriangleIcon,
      iconClassName: "text-danger",
    }
  }

  if (status.mode === "replay-buffer") {
    return {
      label: status.activeGame ?? "Replay Buffer",
      tone: "active" as const,
      Icon: RotateCcwIcon,
      iconClassName: "text-accent",
    }
  }

  if (status.mode === "recording") {
    return {
      label: status.activeGame ?? "Recording",
      tone: "active" as const,
      Icon: ClapperboardIcon,
      iconClassName: "text-accent",
    }
  }

  if (status.runState === "paused") {
    return {
      label: "Capture Paused",
      tone: "warning" as const,
      Icon: PauseCircleIcon,
      iconClassName: "text-warning",
    }
  }

  return {
    label: "Waiting For Game",
    tone: "idle" as const,
    Icon: Gamepad2Icon,
    iconClassName: "text-foreground-muted",
  }
}
