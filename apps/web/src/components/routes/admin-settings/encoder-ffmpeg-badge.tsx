import type { AdminEncoderCapabilities } from "@workspace/api"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { AlertCircleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react"

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
        <span className="text-foreground-muted font-mono font-medium">
          ffmpeg
        </span>
        {error ? (
          <AlertCircleIcon className="text-destructive size-3.5" />
        ) : !caps ? (
          <Spinner className="text-foreground-muted size-3.5" />
        ) : caps.ffmpegOk ? (
          <CheckCircle2Icon className="text-success size-3.5" />
        ) : (
          <XCircleIcon className="text-destructive size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  )
}
