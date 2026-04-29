import * as React from "react"
import { useNavigate } from "@tanstack/react-router"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Drawer, DrawerContent } from "@workspace/ui/components/drawer"
import { toast } from "@workspace/ui/lib/toast"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

import { useSuspenseSession } from "@/lib/session-suspense"
import { FloatingUploadButton } from "./floating-upload-button"
import { useUploadFlowControls } from "./use-upload-flow-controls"
import { type QueueClip } from "@workspace/api"
import {
  ACCEPT_LIST,
  probeFile,
  resolveContentType,
  type PublishPayload,
  type SelectedFile,
} from "./new-clip-helpers"
import { UploadQueueContent, type QueueItem } from "./upload-queue"
import {
  NewClipDialog,
  loadNewClipDialog,
  useWarmEditor,
} from "./upload-dialog-loader"
import { useUploadQueueState } from "./upload-flow-queue-state"

function useNewClipPicker(onPicked: () => void) {
  const [newClipOpen, setNewClipOpen] = React.useState(false)
  const [newClipModalMounted, setNewClipModalMounted] = React.useState(false)
  const [initialFile, setInitialFile] = React.useState<SelectedFile | null>(
    null
  )
  const inputRef = React.useRef<HTMLInputElement>(null)

  const openPicker = React.useCallback(() => {
    setNewClipModalMounted(true)
    void loadNewClipDialog()
    inputRef.current?.click()
  }, [])

  const onFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      const contentType = resolveContentType(file)
      if (!contentType) {
        toast.error("Unsupported file type")
        return
      }
      try {
        const meta = await probeFile(file)
        setInitialFile({ ...meta, contentType })
        onPicked()
        setNewClipOpen(true)
      } catch {
        toast.error("Couldn't read video metadata")
      }
    },
    [onPicked]
  )

  return {
    newClipOpen,
    setNewClipOpen,
    newClipModalMounted,
    setNewClipModalMounted,
    initialFile,
    inputRef,
    openPicker,
    onFileChange,
  }
}

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

function UploadQueuePopover({
  queueOpen,
  setQueueOpen,
  queue,
  activeCount,
  isQueueLoading,
  isQueueUnavailable,
  onNewClip,
  onClearCompleted,
}: {
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  queue: QueueItem[]
  activeCount: number
  isQueueLoading: boolean
  isQueueUnavailable: boolean
  onNewClip: () => void
  onClearCompleted: () => void
}) {
  const isMobile = useIsMobile()
  const queueGlassStyle = {
    "--queue-glass-opacity": "68%",
    "--queue-glass-bg":
      "color-mix(in oklab, var(--popover) var(--queue-glass-opacity), var(--background))",
    "--queue-row-glass-bg":
      "color-mix(in oklab, var(--popover) 18%, var(--background))",
    "--alloy-glass-bg": "var(--queue-glass-bg)",
    "--alloy-glass-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
  } as React.CSSProperties
  const content = (
    <UploadQueueContent
      queue={queue}
      isLoading={isQueueLoading}
      isUnavailable={isQueueUnavailable}
      onNewClip={onNewClip}
      onClearCompleted={onClearCompleted}
      onClose={() => setQueueOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Drawer open={queueOpen} onOpenChange={setQueueOpen}>
        <DrawerContent
          className={cn("max-h-[85vh] p-0", "alloy-glass")}
          style={queueGlassStyle}
          aria-describedby={undefined}
        >
          <div className="p-3">{content}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={queueOpen} onOpenChange={setQueueOpen}>
      <PopoverTrigger
        render={
          <FloatingUploadButton
            activeCount={activeCount}
            isOpen={queueOpen}
            className="hidden md:flex"
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
          "alloy-glass",
          "data-open:animate-[alloy-fab-morph-in_320ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]",
          "data-closed:animate-[alloy-fab-morph-out_180ms_cubic-bezier(0.36,0,0.66,-0.4)_forwards]"
        )}
        style={
          {
            position: "fixed",
            right: "0.75rem",
            bottom: isMobile
              ? "calc(var(--bottomnav-h) + env(safe-area-inset-bottom) + 0.75rem)"
              : "0.75rem",
            top: "auto",
            left: isMobile ? "0.75rem" : "auto",
            transformOrigin: isMobile ? "bottom center" : "bottom right",
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
  const { queueOpen, setQueueOpen, setActiveCount } = useUploadFlowControls()
  const navigate = useNavigate()
  const handleOpenClip = React.useCallback(
    (row: QueueClip) => {
      setQueueOpen(false)
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, clip: row.id }),
        mask: {
          to: "/g/$slug/c/$clipId",
          params: { slug: row.gameSlug, clipId: row.id },
        },
      })
    },
    [navigate]
  )
  const {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
    isQueueLoading,
    isQueueUnavailable,
  } = useUploadQueueState(queueOpen, handleOpenClip)
  const {
    newClipOpen,
    setNewClipOpen,
    newClipModalMounted,
    setNewClipModalMounted,
    initialFile,
    inputRef: newClipFileInputRef,
    openPicker: handleNewClip,
    onFileChange: handleNewClipFileInputChange,
  } = useNewClipPicker(() => setQueueOpen(false))
  useWarmEditor(queueOpen, setNewClipModalMounted)

  React.useEffect(() => {
    setActiveCount(activeCount)
    return () => setActiveCount(0)
  }, [activeCount, setActiveCount])

  const handlePublish = React.useCallback(
    async (payload: PublishPayload) => {
      setNewClipOpen(false)
      setQueueOpen(true)
      try {
        await runUpload(payload)
      } catch {
        // Error lives on the queue row's `failed` status.
      }
    },
    [runUpload, setNewClipOpen]
  )

  return (
    <>
      <input
        ref={newClipFileInputRef}
        type="file"
        accept={ACCEPT_LIST}
        className="hidden"
        onChange={handleNewClipFileInputChange}
      />
      <UploadQueuePopover
        queueOpen={queueOpen}
        setQueueOpen={setQueueOpen}
        queue={queue}
        activeCount={activeCount}
        isQueueLoading={isQueueLoading}
        isQueueUnavailable={isQueueUnavailable}
        onNewClip={handleNewClip}
        onClearCompleted={clearCompleted}
      />
      {newClipModalMounted ? (
        <React.Suspense fallback={null}>
          <NewClipDialog
            open={newClipOpen}
            onOpenChange={setNewClipOpen}
            onPublish={handlePublish}
            initialFile={initialFile ?? undefined}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}
