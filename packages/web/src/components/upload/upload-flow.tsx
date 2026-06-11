import { type QueueClip } from "@alloy/api"
import { Dialog, DialogContent, DialogTitle } from "@alloy/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cn } from "@alloy/ui/lib/utils"
import { useLocation, useNavigate } from "@tanstack/react-router"
import * as React from "react"

import {
  announceFloatingSurfaceOpen,
  type FloatingSurface,
  useFloatingSurfaceOpenListener,
} from "@/components/app/floating-surface-events"
import type { AppSearch } from "@/lib/app-search"
import { useSuspenseSession } from "@/lib/session-suspense"

import type { PublishPayload } from "./new-clip-helpers"
import { useUploadQueueState } from "./upload-flow-queue-state"
import { type QueueItem, UploadQueueContent } from "./upload-queue"
import { UploadStatusIndicator } from "./upload-status-indicator"
import { useUploadFlowControls } from "./use-upload-flow-controls"

export function UploadFlow() {
  return (
    <React.Suspense fallback={null}>
      <UploadFlowInner />
    </React.Suspense>
  )
}

function UploadFlowInner() {
  const session = useSuspenseSession()
  if (!session) return null

  return <AuthedUploadFlow />
}

/** True when an event originated on the floating upload status indicator. */
function pressedUploadIndicator(event: Event): boolean {
  const target = event.target
  return (
    target instanceof Element &&
    target.closest("[data-upload-indicator]") !== null
  )
}

function UploadQueuePopover({
  queueOpen,
  setQueueOpen,
  queue,
  activeCount,
  isQueueLoading,
  isQueueUnavailable,
  onClearCompleted,
}: {
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  queue: QueueItem[]
  activeCount: number
  isQueueLoading: boolean
  isQueueUnavailable: boolean
  onClearCompleted: () => void
}) {
  const isMobile = useIsMobile()
  // The capture editor has its own header Upload action, and the indicator
  // would float over the trim timeline — keep it off that route. The popover
  // content is fixed-positioned, so the queue still opens there after a publish.
  const pathname = useLocation({ select: (location) => location.pathname })
  const onLibraryEditor = /^\/library\/[^/]+/.test(pathname)
  // Uploads only originate from the desktop app, so the indicator is purely a
  // status surface — show it while something is in flight (or the queue is
  // pinned open), never on the editor route.
  const showIndicator = activeCount > 0 && !onLibraryEditor
  const queueGlassStyle = {
    /* Row tint is opaque (it sits inside the already-blurred surface).
       The surface fill itself is left to the default `--alloy-blur-bg`
       which mixes with *transparent*, so the backdrop blur is actually
       visible. */
    "--queue-row-glass-bg":
      "color-mix(in oklab, var(--popover) 18%, var(--background))",
    "--alloy-blur-opacity": "78%",
    "--alloy-blur-blur": "32px",
    "--alloy-blur-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
  } as React.CSSProperties
  const content = (
    <UploadQueueContent
      queue={queue}
      isLoading={isQueueLoading}
      isUnavailable={isQueueUnavailable}
      onClearCompleted={onClearCompleted}
      onClose={() => setQueueOpen(false)}
    />
  )

  const handleFloatingSurfaceOpen = React.useCallback(
    (surface: FloatingSurface) => {
      if (surface !== "uploads") setQueueOpen(false)
    },
    [setQueueOpen],
  )
  useFloatingSurfaceOpenListener(handleFloatingSurfaceOpen)

  React.useEffect(() => {
    if (queueOpen) announceFloatingSurfaceOpen("uploads")
  }, [queueOpen])

  if (isMobile) {
    return (
      <>
        {showIndicator ? (
          <UploadStatusIndicator
            activeCount={activeCount}
            isOpen={queueOpen}
            data-upload-indicator=""
            onClick={() => setQueueOpen(!queueOpen)}
          />
        ) : null}
        <Dialog
          modal={false}
          open={queueOpen}
          onOpenChange={(open, eventDetails) => {
            // The indicator lives outside this non-modal dialog, so a tap to
            // dismiss reaches us as an outside-press. Ignore that one case and
            // let the indicator's own click toggle the queue closed —
            // otherwise this close races the click's reopen and the modal flashes.
            if (
              !open &&
              eventDetails.reason === "outside-press" &&
              pressedUploadIndicator(eventDetails.event)
            ) {
              return
            }
            setQueueOpen(open)
          }}
        >
          <DialogContent
            disableZoom
            centered={false}
            showOverlay={false}
            className={cn(
              "right-3 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+0.75rem)] left-3 z-50 w-auto max-w-none rounded-2xl border p-3",
              "max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-1.5rem)]",
              "alloy-blur",
            )}
            style={queueGlassStyle}
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">Upload queue</DialogTitle>
            {content}
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <Popover open={queueOpen} onOpenChange={setQueueOpen}>
      <PopoverTrigger
        render={
          <UploadStatusIndicator
            activeCount={activeCount}
            isOpen={queueOpen}
            className={cn("hidden", showIndicator && "md:flex")}
          />
        }
      />
      <PopoverContent
        side="top"
        align="end"
        sideOffset={0}
        alignOffset={0}
        className={cn(
          "w-[420px] max-w-[calc(100vw-1.5rem)] border p-3 ring-0",
          "alloy-blur",
          "data-open:animate-[alloy-fab-morph-in_320ms_var(--ease-out)_forwards]",
          "data-closed:animate-[alloy-fab-morph-out_180ms_var(--ease-out)_forwards]",
        )}
        style={
          {
            position: "fixed",
            right: "0.75rem",
            bottom: "0.75rem",
            top: "auto",
            left: "auto",
            transformOrigin: "bottom right",
            ...queueGlassStyle,
          } as React.CSSProperties
        }
        aria-describedby={undefined}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

function AuthedUploadFlow() {
  const { queueOpen, setQueueOpen, setActiveCount, setPublishClip } =
    useUploadFlowControls()
  const navigate = useNavigate()
  const handleOpenClip = React.useCallback(
    (row: QueueClip) => {
      setQueueOpen(false)
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, clip: row.id }),
        mask: {
          to: "/g/$slug/c/$clipId",
          params: { slug: row.gameSlug, clipId: row.id },
        },
      })
    },
    [navigate],
  )
  const {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
    isQueueLoading,
    isQueueUnavailable,
  } = useUploadQueueState(queueOpen, handleOpenClip)

  React.useEffect(() => {
    setActiveCount(activeCount)
    return () => setActiveCount(0)
  }, [activeCount, setActiveCount])

  const publishFromExternalEditor = React.useCallback(
    async (payload: PublishPayload) => {
      setQueueOpen(true)
      await runUpload(payload)
    },
    [runUpload, setQueueOpen],
  )

  React.useEffect(() => {
    setPublishClip(publishFromExternalEditor)
    return () => {
      setPublishClip(null)
    }
  }, [publishFromExternalEditor, setPublishClip])

  return (
    <UploadQueuePopover
      queueOpen={queueOpen}
      setQueueOpen={setQueueOpen}
      queue={queue}
      activeCount={activeCount}
      isQueueLoading={isQueueLoading}
      isQueueUnavailable={isQueueUnavailable}
      onClearCompleted={clearCompleted}
    />
  )
}
