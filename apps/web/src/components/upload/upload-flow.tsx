import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { toast } from "@workspace/ui/components/sonner"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "@/lib/auth-client"
import { FloatingUploadButton } from "./floating-upload-button"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import {
  deleteClip,
  finalizeClip,
  initiateClip,
  uploadToTicket,
  type QueueClip,
} from "@/lib/clips-api"
import {
  hueFor,
  localToQueueItem,
  serverToQueueItem,
  type ActiveUpload,
} from "./upload-queue-mapping"
import {
  ACCEPT_LIST,
  probeFile,
  resolveContentType,
  type PublishPayload,
  type SelectedFile,
} from "./new-clip-dialog"
import { UploadQueueContent, type QueueItem } from "./upload-queue"
import { useDismissedClips } from "./use-dismissed-clips"

const loadNewClipDialog = () => import("./new-clip-dialog")
const NewClipDialog = React.lazy(() =>
  loadNewClipDialog().then((m) => ({
    default: m.NewClipDialog,
  }))
)

async function performUpload(
  payload: PublishPayload,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void
): Promise<void> {
  const { clipId, ticket, thumbTicket } = await initiateClip({
    filename: payload.file.name,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    title: payload.title,
    description: payload.description ?? undefined,
    gameId: payload.gameId,
    privacy: payload.privacy,
    trimStartMs: payload.trimStartMs ?? undefined,
    trimEndMs: payload.trimEndMs ?? undefined,
    thumbSizeBytes: payload.thumbBlob.size,
    mentionedUserIds:
      payload.mentionedUserIds.length > 0
        ? payload.mentionedUserIds
        : undefined,
  })

  entry.clipId = clipId
  entry.status = "uploading"
  bump()

  await uploadToTicket(
    ticket,
    payload.file,
    (loaded, total) => {
      entry.bytesLoaded = loaded
      entry.bytesTotal = total
      bump()
    },
    entry.abort.signal
  )

  await uploadToTicket(
    thumbTicket,
    payload.thumbBlob,
    () => undefined,
    entry.abort.signal
  )

  entry.status = "finalizing"
  bump()

  await finalizeClip(clipId)
  void invalidateClips()
}

function useServerQueueSync(
  serverQueue: QueueClip[],
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void
) {
  const invalidateClips = useInvalidateClips()
  const readyNotifiedRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    if (serverQueue.length === 0) return
    const seen = new Set(serverQueue.map((r) => r.id))
    let changed = false
    for (const [localId, active] of activeRef.current) {
      if (
        active.clipId &&
        seen.has(active.clipId) &&
        active.status !== "uploading"
      ) {
        URL.revokeObjectURL(active.thumbUrl)
        activeRef.current.delete(localId)
        changed = true
      }
    }
    if (changed) bump()
    let becameReady = false
    for (const row of serverQueue) {
      if (row.status === "ready" && !readyNotifiedRef.current.has(row.id)) {
        readyNotifiedRef.current.add(row.id)
        becameReady = true
      }
    }
    if (becameReady) void invalidateClips()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverQueue])
}

function useCancelRow(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void
) {
  const queryClient = useQueryClient()
  const invalidateClips = useInvalidateClips()
  return React.useCallback(
    (localId: string | null, clipId: string | null) => {
      if (localId) {
        const entry = activeRef.current.get(localId)
        if (entry) {
          entry.abort.abort()
          if (entry.status !== "uploading") {
            URL.revokeObjectURL(entry.thumbUrl)
            activeRef.current.delete(localId)
            bump()
            if (entry.clipId) {
              void deleteClip(entry.clipId).catch(() => undefined)
            }
          }
        }
      }
      if (clipId) {
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          old ? old.filter((r) => r.id !== clipId) : old
        )
        void deleteClip(clipId)
          .then(() => invalidateClips())
          .catch(() => undefined)
      }
    },
    [invalidateClips, queryClient, bump, activeRef]
  )
}

function useRunUpload(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void
) {
  const invalidateClips = useInvalidateClips()
  return React.useCallback(
    async (payload: PublishPayload) => {
      const localId = `local-${Math.random().toString(36).slice(2)}`
      const entry: ActiveUpload = {
        localId,
        title: payload.title,
        hue: hueFor(payload.title),
        bytesTotal: payload.sizeBytes,
        bytesLoaded: 0,
        status: "initiating",
        abort: new AbortController(),
        thumbUrl: URL.createObjectURL(payload.thumbBlob),
      }
      activeRef.current.set(localId, entry)
      bump()

      try {
        await performUpload(payload, entry, bump, invalidateClips)
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          URL.revokeObjectURL(entry.thumbUrl)
          activeRef.current.delete(localId)
          bump()
          if (entry.clipId) {
            void deleteClip(entry.clipId).catch(() => undefined)
          }
          return
        }
        entry.status = "error"
        entry.errorMessage = (err as Error).message
        bump()
        throw err
      }
    },
    [invalidateClips, bump, activeRef]
  )
}

function useUploadQueueState(
  queueOpen: boolean,
  onOpenClip: (row: QueueClip) => void
) {
  const activeRef = React.useRef<Map<string, ActiveUpload>>(new Map())
  const [, bumpState] = React.useReducer((n: number) => n + 1, 0)
  const bump = React.useCallback(() => bumpState(), [])

  const { data: serverQueueData } = useUploadQueueQuery({ enabled: queueOpen })
  const serverQueue = React.useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData]
  )

  useServerQueueSync(serverQueue, activeRef, bump)
  const runUpload = useRunUpload(activeRef, bump)
  const cancelRow = useCancelRow(activeRef, bump)
  const { dismissed, dismiss, dismissMany } = useDismissedClips(serverQueue)

  const queue: QueueItem[] = React.useMemo(() => {
    const localEntries = Array.from(activeRef.current.values())
    const localClipIds = new Set(
      localEntries.map((e) => e.clipId).filter((x): x is string => Boolean(x))
    )
    const fromLocal = localEntries.map((e) =>
      localToQueueItem(e, () => cancelRow(e.localId, e.clipId ?? null))
    )
    const fromServer = serverQueue
      .filter((row) => !localClipIds.has(row.id) && !dismissed.has(row.id))
      .map((row) =>
        serverToQueueItem(row, {
          onCancel: () => cancelRow(null, row.id),
          onOpen: row.status === "ready" ? () => onOpenClip(row) : undefined,
          onCopyLink:
            row.status === "ready" ? () => copyClipLink(row) : undefined,
          onDismiss: row.status === "ready" ? () => dismiss(row.id) : undefined,
        })
      )
    return [...fromLocal, ...fromServer]
  }, [serverQueue, cancelRow, onOpenClip, dismissed, dismiss])

  const activeCount = queue.filter(
    (q) => q.status !== "published" && q.status !== "failed"
  ).length

  const clearCompleted = React.useCallback(() => {
    const readyIds = serverQueue
      .filter((r) => r.status === "ready" && !dismissed.has(r.id))
      .map((r) => r.id)
    dismissMany(readyIds)
  }, [serverQueue, dismissed, dismissMany])

  return { runUpload, queue, activeCount, clearCompleted }
}

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
        toast.error("Unsupported file type", {
          description:
            file.type || file.name.split(".").pop()?.toLowerCase() || "unknown",
        })
        return
      }
      try {
        const meta = await probeFile(file)
        setInitialFile({ ...meta, contentType })
        onPicked()
        setNewClipOpen(true)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to read file"
        toast.error("Couldn't read video metadata", { description: message })
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

function useWarmEditor(queueOpen: boolean, setMounted: (m: boolean) => void) {
  React.useEffect(() => {
    if (!queueOpen) return
    const warmEditor = () => {
      setMounted(true)
      void loadNewClipDialog()
    }
    if (typeof window === "undefined") return
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warmEditor, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const timeout = globalThis.setTimeout(warmEditor, 250)
    return () => globalThis.clearTimeout(timeout)
  }, [queueOpen, setMounted])
}

export function UploadFlow() {
  const { data: session } = useSession()
  if (!session) return null

  return <AuthedUploadFlow />
}

function UploadQueuePopover({
  queueOpen,
  setQueueOpen,
  queue,
  activeCount,
  onNewClip,
  onClearCompleted,
}: {
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  queue: QueueItem[]
  activeCount: number
  onNewClip: () => void
  onClearCompleted: () => void
}) {
  const isMobile = useIsMobile()
  const queueGlassStyle = {
    "--queue-glass-opacity": "68%",
    "--queue-glass-bg":
      "color-mix(in oklab, var(--popover) var(--queue-glass-opacity), transparent)",
    "--queue-row-glass-bg":
      "color-mix(in oklab, var(--popover) 18%, transparent)",
    "--alloy-glass-bg": "var(--queue-glass-bg)",
    "--alloy-glass-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
  } as React.CSSProperties
  const content = (
    <UploadQueueContent
      queue={queue}
      onNewClip={onNewClip}
      onClearCompleted={onClearCompleted}
      onClose={() => setQueueOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Dialog open={queueOpen} onOpenChange={setQueueOpen}>
        <DialogTrigger
          render={
            <FloatingUploadButton
              activeCount={activeCount}
              isOpen={queueOpen}
            />
          }
        />
        <DialogContent
          showOverlay={false}
          disableZoom
          centered={false}
          className={cn(
            "top-auto right-4 left-4 z-50 w-auto max-w-none rounded-2xl border p-3",
            "bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+1rem)]",
            "max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-2rem)]",
            "alloy-glass"
          )}
          style={queueGlassStyle}
          aria-describedby={undefined}
        >
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover open={queueOpen} onOpenChange={setQueueOpen}>
      <PopoverTrigger
        render={
          <FloatingUploadButton activeCount={activeCount} isOpen={queueOpen} />
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

function clipLinkFor(row: QueueClip): string {
  return `${window.location.origin}/g/${row.gameSlug}/c/${row.id}`
}

async function copyClipLink(row: QueueClip): Promise<void> {
  try {
    await navigator.clipboard.writeText(clipLinkFor(row))
    toast.success("Clip link copied")
  } catch (err) {
    toast.error("Couldn't copy link", {
      description: err instanceof Error ? err.message : "Please try again.",
    })
  }
}

function AuthedUploadFlow() {
  const [queueOpen, setQueueOpen] = React.useState(false)
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
  const { runUpload, queue, activeCount, clearCompleted } = useUploadQueueState(
    queueOpen,
    handleOpenClip
  )
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
