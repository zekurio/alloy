import * as React from "react"
import { UploadIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { SelectedFile } from "./upload-new-clip-modal"
import type { QueueItem } from "./upload-queue-modal"

// The upload modals pull in heavy form/timeline/dialog machinery that isn't
// needed until the FAB is opened. Splitting them into their own chunks keeps
// the initial home-route bundle smaller.
const UploadQueueModal = React.lazy(() =>
  import("./upload-queue-modal").then((m) => ({ default: m.UploadQueueModal }))
)
const UploadNewClipModal = React.lazy(() =>
  import("./upload-new-clip-modal").then((m) => ({
    default: m.UploadNewClipModal,
  }))
)

/**
 * Mock queue — in-progress, encoding, queued, and recently published.
 * Matches the preview state the home screen is built around.
 */
const INITIAL_QUEUE: Array<QueueItem> = [
  {
    id: "1",
    title: "Clutch 1v3 on Ascent",
    status: "uploading",
    progress: 68,
    detail: "0:41 remaining",
    hue: 300,
  },
  {
    id: "2",
    title: "Triple kill — map control",
    status: "encoding",
    progress: 42,
    detail: "H.264 1080p",
    hue: 30,
  },
  {
    id: "3",
    title: "200 IQ smoke wall",
    status: "queued",
    progress: 0,
    detail: "position 1",
    hue: 220,
  },
  {
    id: "4",
    title: "Last-second defuse",
    status: "published",
    progress: 100,
    detail: "2 min ago",
    hue: 45,
  },
]

const DEMO_FILE: SelectedFile = {
  name: "clutch_ascent.mp4",
  size: "214 MB",
  resolution: "1920×1080",
  fps: "60FPS",
  duration: "3:04",
}

/**
 * Top-level upload UX: floating FAB in the bottom-right plus the two
 * modals it drives.
 *
 *   FAB  ──▶  UploadQueueModal  ──▶  UploadNewClipModal
 *
 * State is local to this component — the rest of the app treats upload
 * as an opaque widget and only needs to mount `<UploadFlow />` once.
 */
export function UploadFlow() {
  const [queueOpen, setQueueOpen] = React.useState(false)
  const [newClipOpen, setNewClipOpen] = React.useState(false)
  const [queue] = React.useState<Array<QueueItem>>(INITIAL_QUEUE)
  const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(
    null
  )
  // Defer even mounting the lazy modal chunks until the user touches the
  // FAB — otherwise an always-closed <Dialog> would still pull them in on
  // the initial render.
  const [modalsMounted, setModalsMounted] = React.useState(false)

  const activeCount = queue.filter(
    (q) => q.status !== "published"
  ).length

  // Hand-off: close the queue first, then open the new-clip modal once
  // the queue's exit animation has finished (~100ms). Swapping both in
  // the same frame plays two competing zoom/fade animations on top of
  // each other — staggering them makes it feel like one modal is
  // passing the baton to the next.
  const handoffTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (handoffTimer.current !== null) {
        window.clearTimeout(handoffTimer.current)
      }
    },
    []
  )

  const handleNewClip = () => {
    setQueueOpen(false)
    if (handoffTimer.current !== null) {
      window.clearTimeout(handoffTimer.current)
    }
    handoffTimer.current = window.setTimeout(() => {
      setNewClipOpen(true)
      handoffTimer.current = null
    }, 120)
  }

  return (
    <>
      <FloatingUploadButton
        onClick={() => {
          setModalsMounted(true)
          setQueueOpen(true)
        }}
        activeCount={activeCount}
      />
      {modalsMounted ? (
        <React.Suspense fallback={null}>
          <UploadQueueModal
            open={queueOpen}
            onOpenChange={setQueueOpen}
            queue={queue}
            onNewClip={handleNewClip}
          />
          <UploadNewClipModal
            open={newClipOpen}
            onOpenChange={(next) => {
              setNewClipOpen(next)
              if (!next) setSelectedFile(null)
            }}
            selectedFile={selectedFile}
            onSelectFile={() => setSelectedFile(DEMO_FILE)}
            onClearFile={() => setSelectedFile(null)}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}

/**
 * The bottom-right FAB. 48px accent-blue circle with an upload icon; a
 * tiny dark-bubble count badge surfaces unfinished uploads (uploading /
 * encoding / queued).
 */
function FloatingUploadButton({
  onClick,
  activeCount,
}: {
  onClick: () => void
  activeCount: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        activeCount > 0
          ? `Open uploads — ${activeCount} in progress`
          : "Open uploads"
      }
      className={cn(
        "group/fab fixed right-6 bottom-6 z-40",
        "flex size-12 items-center justify-center rounded-full",
        "bg-accent text-accent-foreground",
        "border border-accent",
        "shadow-lg shadow-black/40",
        "transition-[background,transform,box-shadow]",
        "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-accent-hover hover:-translate-y-0.5 hover:shadow-xl",
        "active:translate-y-0 active:bg-accent-active",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      <UploadIcon className="size-5" />
      {activeCount > 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center px-1",
            "rounded-full border-2 border-background bg-surface-raised",
            "font-mono text-2xs font-semibold text-foreground tabular-nums"
          )}
        >
          {activeCount}
        </span>
      ) : null}
    </button>
  )
}
