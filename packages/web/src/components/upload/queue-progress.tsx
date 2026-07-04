import type { EncodeStage } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { Progress } from "@base-ui/react/progress"
import { CopyIcon, ExternalLinkIcon, RefreshCwIcon, XIcon } from "lucide-react"
import type { ReactNode } from "react"

import { isCompletedQueueStatus, type QueueItem } from "./upload-queue-types"

/**
 * Localized stage label for an encode run, shared by the upload queue mapping,
 * the library cards, the global pill, and the watch-page overlay so every
 * surface reads the same wording. Tier metadata is only shown for the
 * per-tier encoding stage; everything else collapses to a single verb.
 */
export function encodeStageLabel(input: {
  stage: EncodeStage | null
  tier?: string | null
  tierIndex?: number | null
  tierCount?: number | null
}): string {
  switch (input.stage) {
    case "downloading":
      return t("Downloading")
    case "encoding":
      if (input.tier && input.tierIndex && input.tierCount) {
        return t("Encoding {tier} ({index}/{count})", {
          tier: input.tier,
          index: input.tierIndex,
          count: input.tierCount,
        })
      }
      return t("Encoding")
    case "finalizing":
      return t("Finalizing")
    case "processing":
    default:
      return t("Processing")
  }
}

/** Thin progress bar with an optional right-aligned percentage. */
export function QueueProgressBar({
  value,
  indeterminate = false,
  showPercent = false,
  className,
  label,
}: {
  value: number
  indeterminate?: boolean
  showPercent?: boolean
  className?: string
  label?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <Progress.Root
      value={indeterminate ? null : clamped}
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <Progress.Track className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        {indeterminate ? (
          <span className="animate-indeterminate bg-accent absolute inset-y-0 left-0 w-1/3 rounded-full" />
        ) : (
          <Progress.Indicator className="bg-accent h-full rounded-full transition-all duration-300 ease-out" />
        )}
      </Progress.Track>
      {showPercent && !indeterminate ? (
        <Progress.Value className="text-2xs text-foreground-faint w-8 shrink-0 text-right tabular-nums" />
      ) : null}
    </Progress.Root>
  )
}

/**
 * A single upload/download/processing row: thumbnail, title, stage label +
 * progress, and the contextual actions the caller wired onto the item. Used by
 * the global upload pill's popover; library cards use the bare
 * {@link QueueProgressBar} instead because their meta line is space-limited.
 */
export function QueueItemRow({ item }: { item: QueueItem }) {
  const failed = item.status === "failed"
  const done = isCompletedQueueStatus(item.status)
  const inProgress = !failed && !done
  const showBar = inProgress && item.showProgress !== false
  return (
    <div className="flex items-center gap-3">
      <QueueThumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-foreground truncate text-sm leading-tight font-medium">
          {item.title}
        </div>
        {item.label ? (
          <div
            className={cn(
              "truncate text-xs leading-tight",
              failed ? "text-destructive" : "text-foreground-muted",
            )}
          >
            {item.label}
          </div>
        ) : null}
        {showBar ? (
          <QueueProgressBar
            value={item.progress}
            indeterminate={item.indeterminate}
            showPercent={!item.indeterminate}
            label={item.label ?? item.title}
          />
        ) : null}
      </div>
      <QueueItemActions item={item} />
    </div>
  )
}

function QueueThumb({ item }: { item: QueueItem }) {
  const thumb = item.thumbUrl ?? item.thumbFallbackUrl ?? null
  return (
    <div
      className="bg-surface-raised h-8 w-[3.25rem] shrink-0 overflow-hidden rounded"
      style={{ backgroundColor: `hsl(${item.hue} 32% 22%)` }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          onLoad={item.onThumbLoad}
        />
      ) : null}
    </div>
  )
}

function QueueItemActions({ item }: { item: QueueItem }) {
  const failed = item.status === "failed"
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {item.onOpen ? (
        <QueueIconButton label={t("Open")} onClick={item.onOpen}>
          <ExternalLinkIcon />
        </QueueIconButton>
      ) : null}
      {item.onCopyLink ? (
        <QueueIconButton label={t("Copy link")} onClick={item.onCopyLink}>
          <CopyIcon />
        </QueueIconButton>
      ) : null}
      {failed && item.onRetry ? (
        <QueueIconButton label={t("Retry")} onClick={item.onRetry}>
          <RefreshCwIcon />
        </QueueIconButton>
      ) : null}
      {item.onCancel && !failed ? (
        <QueueIconButton label={t("Cancel")} onClick={item.onCancel}>
          <XIcon />
        </QueueIconButton>
      ) : null}
      {item.onDismiss ? (
        <QueueIconButton label={t("Dismiss")} onClick={item.onDismiss}>
          <XIcon />
        </QueueIconButton>
      ) : null}
    </div>
  )
}

function QueueIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-foreground-muted hover:text-foreground size-7"
    >
      {children}
    </Button>
  )
}
