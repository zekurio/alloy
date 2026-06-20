import { type QueueClip } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { Dialog, DialogContent, DialogTitle } from "@alloy/ui/components/dialog"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cn } from "@alloy/ui/lib/utils"
import { useLocation, useNavigate } from "@tanstack/react-router"
import * as React from "react"

import { useCreateActions } from "@/components/layout/create-actions"
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

/** True when an event originated on the control that opens the transfer queue. */
function pressedUploadTrigger(event: Event): boolean {
  const target = event.target
  return (
    target instanceof Element &&
    target.closest("[data-upload-trigger]") !== null
  )
}

function UploadQueuePopover({
  queueOpen,
  setQueueOpen,
  queue,
  activeCount,
  isQueueLoading,
  isQueueUnavailable,
  syncPaused,
  onToggleSyncPause,
  onClearCompleted,
}: {
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  queue: QueueItem[]
  activeCount: number
  isQueueLoading: boolean
  isQueueUnavailable: boolean
  syncPaused: boolean | null
  onToggleSyncPause?: () => void
  onClearCompleted: () => void
}) {
  const isMobile = useIsMobile()
  const pathname = useLocation({ select: (location) => location.pathname })
  const onEditorSurface =
    pathname === "/editor" || /^\/library\/[^/]+/.test(pathname)
  const showIndicator = !onEditorSurface && (activeCount > 0 || queueOpen)
  const { uploadAction } = useCreateActions()
  const queueGlassStyle = {
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
      action={uploadAction}
      syncPaused={syncPaused}
      onToggleSyncPause={onToggleSyncPause}
      onClearCompleted={onClearCompleted}
    />
  )

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
            if (
              !open &&
              eventDetails.reason === "outside-press" &&
              pressedUploadTrigger(eventDetails.event)
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
              "right-3 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom,0px)+0.75rem)] left-3 z-50 w-auto max-w-none rounded-2xl border p-3",
              "max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom,0px)-1.5rem)]",
              "alloy-blur",
            )}
            style={queueGlassStyle}
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">{tx("Transfers")}</DialogTitle>
            {content}
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <Dialog
      modal={false}
      open={queueOpen}
      onOpenChange={(open, eventDetails) => {
        if (
          !open &&
          eventDetails.reason === "outside-press" &&
          pressedUploadTrigger(eventDetails.event)
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
          "bottom-3 left-[calc(var(--sidebar-expanded)+0.75rem)] z-50 w-[420px] max-w-[calc(100vw-var(--sidebar-expanded)-1.5rem)] rounded-lg border p-3",
          "max-h-[calc(100dvh-var(--header-h)-1.5rem)]",
          "alloy-blur",
          "data-open:animate-[alloy-fab-morph-in_260ms_var(--ease-out)_forwards]",
          "data-closed:animate-[alloy-fab-morph-out_160ms_var(--ease-out)_forwards]",
        )}
        style={
          {
            transformOrigin: "bottom left",
            ...queueGlassStyle,
          } as React.CSSProperties
        }
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{tx("Transfers")}</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
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
        search: (prev: AppSearch) => ({
          ...prev,
          clip: row.id,
          comment: undefined,
        }),
        ...(row.steamgriddbId
          ? {
              mask: {
                to: "/games/$gameId/c/$clipId",
                params: {
                  gameId: String(row.steamgriddbId),
                  clipId: row.id,
                },
              },
            }
          : {}),
      })
    },
    [navigate, setQueueOpen],
  )
  const {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
    syncPaused,
    onToggleSyncPause,
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
      return runUpload(payload)
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
      syncPaused={syncPaused}
      onToggleSyncPause={onToggleSyncPause}
      onClearCompleted={clearCompleted}
    />
  )
}
