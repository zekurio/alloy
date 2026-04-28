import {
  AlertCircleIcon,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react"

import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import type { AdminEncoderCapabilities } from "@workspace/api"

export function FfmpegBadge({
  caps,
  error,
}: {
  caps: AdminEncoderCapabilities | null
  error: string | null
}) {
  const tooltipText = error
    ? error
    : caps
      ? caps.ffmpegOk
        ? (caps.ffmpegVersion ?? "ffmpeg detected")
        : "Not found — set FFMPEG_BIN or add ffmpeg to PATH"
      : "Checking ffmpeg availability"
  const failed = error !== null || caps?.ffmpegOk === false

  return (
    <Tooltip>
      <TooltipTrigger
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
          failed
            ? "border-destructive/30 bg-destructive/5"
            : "border-border bg-surface-raised"
        }`}
      >
        <span className="font-mono font-medium text-foreground-muted">
          ffmpeg
        </span>
        {error ? (
          <AlertCircleIcon className="size-3.5 text-destructive" />
        ) : !caps ? (
          <Spinner className="size-3.5 text-foreground-muted" />
        ) : caps.ffmpegOk ? (
          <CheckCircle2Icon className="size-3.5 text-success" />
        ) : (
          <XCircleIcon className="size-3.5 text-destructive" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  )
}
