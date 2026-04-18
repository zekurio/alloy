import {
  EyeIcon,
  PauseIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

export type QueueItemStatus =
  | "uploading"
  | "encoding"
  | "queued"
  | "published"

export interface QueueItem {
  id: string
  title: string
  status: QueueItemStatus
  /** 0–100. `queued` items should pass 0. */
  progress: number
  /** Second line of the row: "0:41 remaining", "H.264 1080p", etc. */
  detail: string
  /** Hue 0–360 — drives the thumbnail gradient so rows stay glanceable. */
  hue: number
}

interface UploadQueueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queue: Array<QueueItem>
  /** Opens the "new clip" modal — triggered by the footer Upload button. */
  onNewClip: () => void
}

/**
 * Uploads queue — the list view that the floating FAB opens. Each row
 * shows a tinted thumbnail, title, status line, progress bar, numeric
 * percentage, and the appropriate action (pause / delete / view).
 *
 * A footer "Upload" button cross-navigates to the New Clip modal; "Hide"
 * dismisses the queue without cancelling anything in flight.
 */
export function UploadQueueModal({
  open,
  onOpenChange,
  queue,
  onNewClip,
}: UploadQueueModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[640px]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Uploads</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2 px-5 py-4">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                Nothing in the queue
              </p>
              <p className="text-sm text-foreground-dim">
                Uploaded clips will show up here.
              </p>
            </div>
          ) : (
            queue.map((item) => <QueueRow key={item.id} item={item} />)
          )}
        </DialogBody>

        <footer
          className={cn(
            "flex items-center justify-between gap-2",
            "border-t border-border bg-background px-5 py-3"
          )}
        >
          <Button
            variant="accent-outline"
            size="sm"
            onClick={onNewClip}
          >
            <UploadIcon />
            Upload
          </Button>
          <DialogClose
            render={<Button variant="secondary" size="sm" />}
          >
            Hide
          </DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

/* ────────────────────────────────────────────────────────────────────── */

function QueueRow({ item }: { item: QueueItem }) {
  const tone = STATUS_TONES[item.status]

  return (
    <article
      data-slot="queue-row"
      className={cn(
        "group/row relative flex items-center gap-3",
        "rounded-md border border-border bg-surface px-3 py-2.5",
        "transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong"
      )}
    >
      {/* Thumbnail */}
      <div
        aria-hidden
        className="relative h-10 w-[68px] shrink-0 overflow-hidden rounded-sm"
        style={{
          background: `linear-gradient(135deg, oklch(0.3 0.1 ${item.hue}) 0%, oklch(0.15 0.05 ${item.hue}) 70%, oklch(0.08 0 0) 100%)`,
        }}
      />

      {/* Title + detail + progress */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
            {item.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-2xs tracking-[0.02em] text-foreground-faint">
          <span className={cn("font-medium uppercase", tone.label)}>
            {STATUS_LABELS[item.status]}
          </span>
          <span className="text-foreground-faint">·</span>
          <span className="truncate">{item.detail}</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          className="relative h-[3px] w-full overflow-hidden rounded-full bg-neutral-200"
        >
          {item.status !== "queued" ? (
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[var(--ease-out)]",
                tone.bar
              )}
              style={{ width: `${item.progress}%` }}
            />
          ) : null}
        </div>
      </div>

      {/* Percent + action */}
      <div className="flex shrink-0 items-center gap-2 self-start pt-0.5">
        <span
          className={cn(
            "w-10 text-right font-mono text-xs font-medium tabular-nums",
            tone.label
          )}
        >
          {item.status === "queued" ? "—" : `${item.progress}%`}
        </span>
        <RowAction status={item.status} title={item.title} />
      </div>
    </article>
  )
}

function RowAction({
  status,
  title,
}: {
  status: QueueItemStatus
  title: string
}) {
  if (status === "uploading" || status === "encoding") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Pause ${title}`}
      >
        <PauseIcon />
      </Button>
    )
  }
  if (status === "queued") {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${title} from queue`}
      >
        <Trash2Icon />
      </Button>
    )
  }
  // published
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`View ${title}`}
    >
      <EyeIcon />
    </Button>
  )
}

/* ────────────────────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<QueueItemStatus, string> = {
  uploading: "Upload",
  encoding: "Encoding",
  queued: "Queued",
  published: "Published",
}

const STATUS_TONES: Record<
  QueueItemStatus,
  { label: string; bar: string }
> = {
  uploading: { label: "text-accent", bar: "bg-accent" },
  encoding: { label: "text-warning", bar: "bg-warning" },
  queued: { label: "text-foreground-faint", bar: "" },
  published: { label: "text-success", bar: "bg-success" },
}
