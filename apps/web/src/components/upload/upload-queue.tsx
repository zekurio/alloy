import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

export type QueueItemStatus =
  | "uploading"
  | "encoding"
  | "queued"
  | "published"
  | "failed"

export interface QueueItem {
  id: string
  title: string
  status: QueueItemStatus
  /** 0–100. `queued` items should pass 0. */
  progress: number
  /** Second line of the row: "0:41 remaining", "H.264 1080p", etc. */
  detail: string
  /** Hue 0–360 — drives the thumbnail gradient placeholder. */
  hue: number
  thumbUrl?: string | null
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
  /** Optional callbacks the FlowController wires per row. */
  onCancel?: () => void
  onRetry?: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  /** Removes a finished (published) row from the local view only. */
  onDismiss?: () => void
}

interface UploadQueueContentProps {
  queue: Array<QueueItem>
  /** True until the initial server queue snapshot has populated the cache. */
  isLoading?: boolean
  /** Opens the file picker for a new upload. */
  onNewClip: () => void
  /** Dismisses every finished (published) row in one go. */
  onClearCompleted?: () => void
  /** Closes the surrounding queue surface. */
  onClose?: () => void
}

const PAGE_SIZE = 6

export function UploadQueueContent({
  queue,
  isLoading = false,
  onNewClip,
  onClearCompleted,
  onClose,
}: UploadQueueContentProps) {
  const [page, setPage] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(queue.length / PAGE_SIZE))

  // Clamp the active page when rows disappear (dismissed, completed, etc.).
  React.useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  const completedCount = queue.filter((q) => q.status === "published").length
  const start = page * PAGE_SIZE
  const visible = queue.slice(start, start + PAGE_SIZE)

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">Uploads</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground-muted tabular-nums">
            {isLoading && queue.length === 0
              ? "loading"
              : queue.length === 0
                ? "empty"
                : `${queue.length} ${queue.length === 1 ? "item" : "items"}`}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {isLoading && queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-border px-6 py-8 text-center">
            <Loader2Icon
              aria-hidden
              className="size-4 animate-spin text-foreground-muted"
            />
            <p className="text-sm font-medium text-foreground">
              Loading uploads
            </p>
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-6 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Nothing in the queue
            </p>
            <p className="text-xs font-semibold text-foreground-muted">
              Uploaded clips will show up here.
            </p>
          </div>
        ) : (
          visible.map((item) => <QueueRow key={item.id} item={item} />)
        )}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 px-1 text-xs font-semibold text-foreground-muted">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end border-t border-border pt-2.5">
        <div className="flex items-center gap-2">
          {completedCount > 0 && onClearCompleted ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearCompleted}
              className="text-foreground-muted"
            >
              Clear completed
            </Button>
          ) : null}
          {onClose ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close uploads"
              onClick={onClose}
              className="text-foreground-muted"
            >
              Close
            </Button>
          ) : null}
          <Button variant="primary" size="sm" onClick={onNewClip}>
            <UploadIcon />
            Upload clip
          </Button>
        </div>
      </div>
    </div>
  )
}

function QueueRow({ item }: { item: QueueItem }) {
  const tone = STATUS_TONES[item.status]
  const showPct = item.status === "uploading" || item.status === "encoding"

  return (
    <article
      data-slot="queue-row"
      className={cn(
        "group/row alloy-glass relative flex flex-col gap-2",
        "rounded-md border px-3 py-2.5",
        "transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong"
      )}
      style={
        {
          "--alloy-glass-bg": "var(--queue-row-glass-bg)",
          "--alloy-glass-shadow": "0 12px 32px -28px rgb(0 0 0 / 0.48)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-3">
        <QueueThumb
          thumbUrl={item.thumbUrl ?? null}
          fallbackUrl={item.thumbFallbackUrl ?? null}
          hue={item.hue}
          onLoad={item.onThumbLoad}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
              {item.title}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground-muted">
            <span className={cn("font-medium uppercase", tone.label)}>
              {STATUS_LABELS[item.status]}
            </span>
            {showPct ? (
              <span className={cn("font-semibold tabular-nums", tone.label)}>
                {item.progress}%
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-0.5">
          <RowAction item={item} />
        </div>
      </div>

      <Progress
        value={item.progress}
        indicatorClassName={cn(
          "duration-500 ease-[var(--ease-out)]",
          tone.bar || "bg-transparent"
        )}
      />
    </article>
  )
}

function QueueThumb({
  thumbUrl,
  fallbackUrl,
  hue,
  onLoad,
}: {
  thumbUrl: string | null
  fallbackUrl: string | null
  hue: number
  onLoad?: () => void
}) {
  const [errored, setErrored] = React.useState(false)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  React.useEffect(() => {
    setErrored(false)
    setLoadedSrc(null)
  }, [thumbUrl])

  const showFallback = Boolean(
    fallbackUrl && thumbUrl && loadedSrc !== thumbUrl
  )

  return (
    <div
      aria-hidden
      className="relative h-10 w-[68px] shrink-0 overflow-hidden rounded-sm"
      style={{
        background: `linear-gradient(135deg, oklch(0.3 0.1 ${hue}) 0%, oklch(0.15 0.05 ${hue}) 70%, oklch(0.08 0 0) 100%)`,
      }}
    >
      {showFallback ? (
        <img
          src={fallbackUrl!}
          alt=""
          className="absolute inset-0 size-full object-cover"
          decoding="async"
        />
      ) : null}
      {thumbUrl && !errored ? (
        <img
          src={thumbUrl}
          alt=""
          className={cn("size-full object-cover", showFallback && "opacity-0")}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setLoadedSrc(thumbUrl)
            onLoad?.()
          }}
          onError={() => setErrored(true)}
        />
      ) : null}
    </div>
  )
}

function RowAction({ item }: { item: QueueItem }) {
  const { status, title } = item
  if (status === "uploading") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Cancel upload of ${title}`}
        onClick={item.onCancel}
      >
        <PauseIcon />
      </Button>
    )
  }
  if (status === "encoding" || status === "queued" || status === "failed") {
    const label =
      status === "failed"
        ? `Remove failed clip ${title}`
        : `Remove ${title} from queue`
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={item.onCancel}
      >
        <Trash2Icon />
      </Button>
    )
  }
  if (status === "published") {
    return (
      <>
        {item.onCopyLink ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy link to ${title}`}
            onClick={item.onCopyLink}
          >
            <CopyIcon />
          </Button>
        ) : null}
        {item.onOpen ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open ${title}`}
            onClick={item.onOpen}
          >
            <ExternalLinkIcon />
          </Button>
        ) : null}
        {item.onDismiss ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Dismiss ${title} from queue`}
            onClick={item.onDismiss}
          >
            <XIcon />
          </Button>
        ) : null}
      </>
    )
  }
  return null
}

const STATUS_LABELS: Record<QueueItemStatus, string> = {
  uploading: "Upload",
  encoding: "Encoding",
  queued: "Queued",
  published: "Published",
  failed: "Failed",
}

const STATUS_TONES: Record<QueueItemStatus, { label: string; bar: string }> = {
  uploading: { label: "text-accent", bar: "bg-accent" },
  encoding: { label: "text-warning", bar: "bg-warning" },
  queued: { label: "text-foreground-faint", bar: "" },
  published: { label: "text-success", bar: "bg-success" },
  failed: { label: "text-destructive", bar: "bg-destructive" },
}
