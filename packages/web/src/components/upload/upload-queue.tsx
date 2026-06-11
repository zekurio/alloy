import { Button } from "@alloy/ui/components/button"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { Progress } from "@alloy/ui/components/progress"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  Loader2Icon,
  PauseIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import * as React from "react"

export type QueueItemStatus =
  | "uploading"
  | "encoding"
  | "queued"
  | "published"
  | "downloading"
  | "downloaded"
  | "failed"

/** Terminal, successful states — both clear out via "Clear completed". */
export function isCompletedQueueStatus(status: QueueItemStatus): boolean {
  return status === "published" || status === "downloaded"
}

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
  thumbBlurHash?: string | null
  thumbFallbackUrl?: string | null
  onThumbLoad?: () => void
  /** Optional callbacks the FlowController wires per row. */
  onCancel?: () => void
  onOpen?: () => void
  onCopyLink?: () => void
  /** Removes a finished (published) row from the local view only. */
  onDismiss?: () => void
}

interface UploadQueueContentProps {
  queue: Array<QueueItem>
  /** True until the initial server queue snapshot has populated the cache. */
  isLoading?: boolean
  /** True when the initial server queue stream could not hydrate the cache. */
  isUnavailable?: boolean
  /** Dismisses every finished (published) row in one go. */
  onClearCompleted?: () => void
  /** Closes the surrounding queue surface. */
  onClose?: () => void
}

const PAGE_SIZE = 6
const THUMB_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const

export function UploadQueueContent({
  queue,
  isLoading = false,
  isUnavailable = false,
  onClearCompleted,
  onClose,
}: UploadQueueContentProps) {
  const [page, setPage] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(queue.length / PAGE_SIZE))

  // Clamp the active page when rows disappear (dismissed, completed, etc.).
  React.useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  const completedCount = queue.filter((q) =>
    isCompletedQueueStatus(q.status),
  ).length
  const start = page * PAGE_SIZE
  const visible = queue.slice(start, start + PAGE_SIZE)

  return (
    <div className="flex flex-col">
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-foreground text-sm font-semibold">Sync</h2>
        <div className="flex items-center gap-2">
          <span className="text-foreground-muted text-xs font-semibold tabular-nums">
            {isUnavailable && queue.length === 0
              ? "unavailable"
              : isLoading && queue.length === 0
                ? "loading"
                : queue.length === 0
                  ? "empty"
                  : `${queue.length} ${queue.length === 1 ? "item" : "items"}`}
          </span>
        </div>
      </header>

      <div className="-mx-1 flex flex-col">
        {isUnavailable && queue.length === 0 ? (
          <div className="border-border mx-1 flex flex-col items-center justify-center gap-2 rounded-md border px-6 py-8 text-center">
            <CircleAlertIcon
              aria-hidden
              className="text-foreground-muted size-4"
            />
            <div className="space-y-1">
              <p className="text-foreground text-sm font-medium">
                Sync status unavailable
              </p>
              <p className="text-foreground-muted text-xs font-semibold">
                Reopen sync after the connection recovers.
              </p>
            </div>
          </div>
        ) : isLoading && queue.length === 0 ? (
          <div className="border-border mx-1 flex flex-col items-center justify-center gap-2 rounded-md border px-6 py-8 text-center">
            <Loader2Icon
              aria-hidden
              className="text-foreground-muted size-4 animate-spin"
            />
            <p className="text-foreground text-sm font-medium">
              Loading sync activity
            </p>
          </div>
        ) : queue.length === 0 ? (
          <div className="border-border mx-1 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-6 py-8 text-center">
            <p className="text-foreground text-sm font-medium">
              Nothing in the queue
            </p>
            <p className="text-foreground-muted text-xs font-semibold">
              Uploads and downloads will show up here.
            </p>
          </div>
        ) : (
          visible.map((item, index) => (
            <QueueRow key={item.id} item={item} first={index === 0} />
          ))
        )}
      </div>

      {pageCount > 1 ? (
        <div className="text-foreground-muted mt-2 flex items-center justify-between gap-2 px-1 text-xs font-semibold">
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

      <div className="border-border grid auto-cols-fr grid-flow-col items-center gap-2 border-t pt-2">
        {completedCount > 0 && onClearCompleted ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearCompleted}
            className="text-foreground-muted w-full"
          >
            Clear completed
          </Button>
        ) : null}
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close sync status"
            onClick={onClose}
            className="text-foreground-muted w-full"
          >
            Close
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function QueueRow({ item, first }: { item: QueueItem; first: boolean }) {
  const tone = STATUS_TONES[item.status]
  const showPct =
    item.status === "uploading" ||
    item.status === "encoding" ||
    (item.status === "downloading" && item.progress > 0)

  return (
    <article
      data-slot="queue-row"
      className={cn(
        "group/row relative flex flex-col gap-2 rounded-md px-2 py-2.5",
        "transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-raised/60",
        !first &&
          "before:pointer-events-none before:absolute before:inset-x-2 before:-top-px before:h-px before:bg-border",
      )}
    >
      <div className="flex items-center gap-3">
        <QueueThumb
          thumbUrl={item.thumbUrl ?? null}
          thumbBlurHash={item.thumbBlurHash ?? null}
          fallbackUrl={item.thumbFallbackUrl ?? null}
          hue={item.hue}
          onLoad={item.onThumbLoad}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-9">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-foreground truncate text-sm font-semibold tracking-[-0.01em]">
              {item.title}
            </span>
          </div>
          <div className="text-foreground-muted flex min-w-0 items-center gap-1.5 text-xs font-medium">
            <span className={cn("font-medium uppercase", tone.label)}>
              {STATUS_LABELS[item.status]}
            </span>
            {showPct ? (
              <span className={cn("font-semibold tabular-nums", tone.label)}>
                {item.progress}%
              </span>
            ) : null}
            {item.status === "downloading" && item.detail ? (
              <span className="truncate tabular-nums">{item.detail}</span>
            ) : null}
          </div>
          {item.status === "failed" && item.detail ? (
            <p className="text-destructive/90 line-clamp-2 text-xs leading-snug font-medium">
              {item.detail}
            </p>
          ) : null}
        </div>

        <div
          className={cn(
            "absolute top-1.5 right-1.5 flex shrink-0 items-center gap-0.5 rounded-md bg-surface-raised/95 p-0.5",
            "shadow-[0_4px_12px_-4px_rgb(0_0_0_/_0.35)] ring-1 ring-border",
          )}
        >
          <RowAction item={item} />
        </div>
      </div>

      <Progress
        value={item.progress}
        indicatorClassName={cn(
          "duration-500 ease-[var(--ease-out)]",
          tone.bar || "bg-transparent",
        )}
      />
    </article>
  )
}

function QueueThumb({
  thumbUrl,
  thumbBlurHash,
  fallbackUrl,
  hue,
  onLoad,
}: {
  thumbUrl: string | null
  thumbBlurHash: string | null
  fallbackUrl: string | null
  hue: number
  onLoad?: () => void
}) {
  const [errored, setErrored] = React.useState(false)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = React.useState(0)
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRetryTimer = React.useCallback(() => {
    if (!retryTimerRef.current) return
    clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
  }, [])

  React.useEffect(() => {
    clearRetryTimer()
    setErrored(false)
    setLoadedSrc(null)
    setRetryAttempt(0)
  }, [clearRetryTimer, thumbUrl])

  React.useEffect(() => clearRetryTimer, [clearRetryTimer])

  const fallbackSrc =
    fallbackUrl && (!thumbUrl || loadedSrc !== thumbUrl) ? fallbackUrl : null
  const serverThumbSrc =
    thumbUrl && !errored ? retryableImageUrl(thumbUrl, retryAttempt) : null

  return (
    <div
      aria-hidden
      className={cn(
        CLIP_MEDIA_VIEWPORT_CLASS,
        "h-10 w-[calc(2.5rem*16/9)] shrink-0 rounded-sm",
      )}
    >
      <MediaPlaceholder seed={hue} blurHash={thumbBlurHash} />
      {fallbackSrc ? (
        <img
          src={fallbackSrc}
          alt=""
          className={CLIP_MEDIA_CLASS}
          decoding="async"
        />
      ) : null}
      {serverThumbSrc ? (
        <img
          src={serverThumbSrc}
          alt=""
          className={cn(
            CLIP_MEDIA_CLASS,
            loadedSrc !== thumbUrl && "opacity-0",
          )}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            clearRetryTimer()
            setLoadedSrc(thumbUrl)
            setErrored(false)
            onLoad?.()
          }}
          onError={() => {
            const retryDelay = THUMB_RETRY_DELAYS_MS[retryAttempt]
            if (retryDelay === undefined) {
              setErrored(true)
              return
            }
            if (retryTimerRef.current) return
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null
              setRetryAttempt((attempt) => attempt + 1)
            }, retryDelay)
          }}
        />
      ) : null}
    </div>
  )
}

function retryableImageUrl(src: string, attempt: number): string {
  if (attempt === 0) return src
  const hashIndex = src.indexOf("#")
  const base = hashIndex === -1 ? src : src.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : src.slice(hashIndex)
  const separator = base.includes("?") ? "&" : "?"
  return `${base}${separator}retry=${attempt}${hash}`
}

function RowAction({ item }: { item: QueueItem }) {
  const { status, title } = item
  if (status === "uploading" || status === "downloading") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          status === "downloading"
            ? `Cancel download of ${title}`
            : `Cancel upload of ${title}`
        }
        onClick={item.onCancel}
      >
        <PauseIcon />
      </Button>
    )
  }
  if (status === "downloaded") {
    return (
      <>
        {item.onOpen ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reveal ${title} in folder`}
            onClick={item.onOpen}
          >
            <FolderOpenIcon />
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
  downloading: "Download",
  downloaded: "Saved locally",
  failed: "Failed",
}

const STATUS_TONES: Record<QueueItemStatus, { label: string; bar: string }> = {
  uploading: { label: "text-accent", bar: "bg-accent" },
  encoding: { label: "text-warning", bar: "bg-warning" },
  queued: { label: "text-foreground-faint", bar: "" },
  published: { label: "text-success", bar: "bg-success" },
  downloading: { label: "text-accent", bar: "bg-accent" },
  downloaded: { label: "text-success", bar: "bg-success" },
  failed: { label: "text-destructive", bar: "bg-destructive" },
}
