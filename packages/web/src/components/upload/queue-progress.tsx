import type { EncodeStage } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { Progress } from "@base-ui/react/progress"
import {
  CopyIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { useActionFeedback } from "@/lib/use-action-feedback"

import { isCompletedQueueStatus, type QueueItem } from "./upload-queue-types"

/**
 * Localized stage label for an encode run, shared by the upload queue
 * mapping, the library cards, the clip editor's processing notice, and the
 * watch-page overlay so every surface reads the same wording. (The header
 * pill deliberately excludes encode runs — processing progress is contextual
 * to the clip and library views.) Tier metadata is only shown for the
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
  indicatorClassName,
}: {
  value: number
  indeterminate?: boolean
  showPercent?: boolean
  className?: string
  label?: string
  indicatorClassName?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <Progress.Root
      value={indeterminate ? null : clamped}
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <Progress.Track className="bg-foreground/10 relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full">
        {indeterminate ? (
          <span
            className={cn(
              "animate-indeterminate bg-accent absolute inset-y-0 left-0 w-1/3 rounded-full",
              indicatorClassName,
            )}
          />
        ) : (
          <Progress.Indicator
            className={cn(
              "bg-accent h-full rounded-full transition-all duration-300 ease-out",
              indicatorClassName,
            )}
          />
        )}
      </Progress.Track>
      {showPercent && !indeterminate ? (
        <Progress.Value className="text-2xs text-foreground-faint w-8 shrink-0 text-right tabular-nums" />
      ) : null}
    </Progress.Root>
  )
}

/**
 * A single upload/download row: thumbnail, title, stage label + progress,
 * and the contextual actions the caller wired onto the item. Used by the
 * global upload pill's popover; library cards use the bare
 * {@link QueueProgressBar} instead because their meta line is space-limited.
 */
export function QueueItemRow({ item }: { item: QueueItem }) {
  const failed = item.status === "failed"
  const done = isCompletedQueueStatus(item.status)
  const inProgress = !failed && !done
  const showBar = inProgress && item.showProgress !== false
  const tone = queueItemTone(item)
  return (
    <article className="group/row border-border hover:bg-surface-raised/60 relative flex flex-col gap-2 rounded-md border-b px-2 py-2.5 transition-colors last:border-b-0">
      <div className="flex items-center gap-3">
        <QueueThumb item={item} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-9">
          <div className="text-foreground truncate text-sm leading-tight font-semibold tracking-[var(--tracking-tight)]">
            {item.title}
          </div>
          {item.label ? (
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
              <span className={cn("truncate", tone.label)}>{item.label}</span>
              {showBar && !item.indeterminate ? (
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    tone.label,
                  )}
                >
                  {Math.round(item.progress)}%
                </span>
              ) : null}
            </div>
          ) : null}
          {failed && item.detail ? (
            <div className="text-destructive/90 line-clamp-2 text-xs leading-snug font-medium">
              {item.detail}
            </div>
          ) : null}
        </div>
        <div className="bg-surface-raised/95 border-border ring-border absolute top-1.5 right-1.5 flex shrink-0 items-center gap-0.5 rounded-md p-0.5 shadow-[0_4px_12px_-4px_rgb(0_0_0_/_0.35)] ring-1">
          <QueueItemActions item={item} />
        </div>
      </div>
      {showBar ? (
        <QueueProgressBar
          value={item.progress}
          indeterminate={item.indeterminate}
          label={item.label ?? item.title}
          indicatorClassName={tone.bar}
        />
      ) : null}
    </article>
  )
}

function queueItemTone(item: QueueItem) {
  if (item.status === "failed") {
    return { label: "text-destructive", bar: "bg-destructive" }
  }
  if (item.phase === "processing") {
    return { label: "text-warning", bar: "bg-warning" }
  }
  if (isCompletedQueueStatus(item.status)) {
    return { label: "text-success", bar: "bg-success" }
  }
  return { label: "text-accent", bar: "bg-accent" }
}

function QueueThumb({ item }: { item: QueueItem }) {
  const thumb = item.thumbUrl ?? item.thumbFallbackUrl ?? null
  return (
    <div
      className={cn(
        CLIP_MEDIA_VIEWPORT_CLASS,
        "h-10 w-[calc(2.5rem*16/9)] shrink-0 rounded-sm",
      )}
    >
      <MediaPlaceholder seed={item.hue} blurHash={item.thumbBlurHash} />
      {thumb ? (
        <img
          src={thumb}
          alt=""
          aria-hidden
          className={CLIP_MEDIA_CLASS}
          onLoad={item.onThumbLoad}
        />
      ) : null}
    </div>
  )
}

function QueueItemActions({ item }: { item: QueueItem }) {
  const failed = item.status === "failed"
  const completed = isCompletedQueueStatus(item.status)
  return (
    <>
      {item.onOpen ? (
        <QueueIconButton label={t("Open")} onClick={item.onOpen}>
          <ExternalLinkIcon />
        </QueueIconButton>
      ) : null}
      {item.onCopyLink ? <QueueCopyButton onCopy={item.onCopyLink} /> : null}
      {failed && item.onRetry ? (
        <QueueIconButton label={t("Retry")} onClick={item.onRetry}>
          <RefreshCwIcon />
        </QueueIconButton>
      ) : null}
      {item.onCancel && !failed && !completed ? (
        <QueueIconButton label={t("Cancel")} onClick={item.onCancel}>
          <XIcon />
        </QueueIconButton>
      ) : null}
      {item.onDismiss ? (
        <QueueIconButton
          label={t("Remove from queue")}
          onClick={item.onDismiss}
          destructive
        >
          <Trash2Icon />
        </QueueIconButton>
      ) : null}
    </>
  )
}

function QueueCopyButton({ onCopy }: { onCopy: () => Promise<void> }) {
  const feedback = useActionFeedback()
  const label =
    feedback.feedback.state === "success"
      ? t("Copied")
      : feedback.feedback.state === "error"
        ? feedback.feedback.message
        : t("Copy link")
  return (
    <FeedbackButton
      type="button"
      variant="ghost"
      size="icon-sm"
      state={feedback.feedback.state}
      pendingLabel={<span className="sr-only">{t("Copying…")}</span>}
      successLabel={<span className="sr-only">{t("Copied")}</span>}
      errorLabel={<span className="sr-only">{t("Try again")}</span>}
      aria-label={label}
      title={label}
      onClick={() => void feedback.run(onCopy, t("Couldn't copy link"))}
      className="text-foreground-muted hover:text-foreground size-7"
    >
      <CopyIcon />
    </FeedbackButton>
  )
}

function QueueIconButton({
  label,
  onClick,
  children,
  destructive = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  destructive?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "text-foreground-muted size-7",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </Button>
  )
}
