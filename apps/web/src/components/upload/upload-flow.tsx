import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { toast } from "@workspace/ui/lib/toast"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

import { api } from "@/lib/api"
import { useSuspenseSession } from "@/lib/session-suspense"
import { FloatingUploadButton } from "./floating-upload-button"
import { useUploadFlowControls } from "./use-upload-flow-controls"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { uploadToTicket, type QueueClip } from "@workspace/api"
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
} from "./new-clip-helpers"
import { UploadQueueContent, type QueueItem } from "./upload-queue"
import { useDismissedClips } from "./use-dismissed-clips"
import {
  NewClipDialog,
  loadNewClipDialog,
  useWarmEditor,
} from "./upload-dialog-loader"

async function performUpload(
  payload: PublishPayload,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void
): Promise<void> {
  const { clipId, ticket, thumbTicket } = await api.clips.initiate({
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

  await api.clips.finalize(clipId)
  void invalidateClips()
}

function useServerQueueSync(
  serverQueue: QueueClip[],
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
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
        const retained = retainedThumbsRef.current.get(active.clipId)
        if (retained && retained !== active.thumbUrl) {
          URL.revokeObjectURL(retained)
        }
        retainedThumbsRef.current.set(active.clipId, active.thumbUrl)
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
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
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
              void api.clips.delete(entry.clipId).catch(() => undefined)
            }
          }
        }
      }
      if (clipId) {
        const retained = retainedThumbsRef.current.get(clipId)
        if (retained) {
          URL.revokeObjectURL(retained)
          retainedThumbsRef.current.delete(clipId)
        }
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          old ? old.filter((r) => r.id !== clipId) : old
        )
        void api.clips
          .delete(clipId)
          .then(() => invalidateClips())
          .catch(() => undefined)
      }
    },
    [invalidateClips, queryClient, bump, activeRef, retainedThumbsRef]
  )
}

function useRunUpload(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
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
        if (entry.clipId) {
          retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
        } else {
          URL.revokeObjectURL(entry.thumbUrl)
        }
        activeRef.current.delete(localId)
        bump()
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          URL.revokeObjectURL(entry.thumbUrl)
          activeRef.current.delete(localId)
          bump()
          if (entry.clipId) {
            void api.clips.delete(entry.clipId).catch(() => undefined)
          }
          return
        }
        if (entry.clipId) {
          void api.clips.delete(entry.clipId).catch(() => undefined)
        }
        entry.status = "error"
        entry.errorMessage = (err as Error).message
        bump()
        throw err
      }
    },
    [invalidateClips, bump, activeRef, retainedThumbsRef]
  )
}

function useUploadQueueState(
  queueOpen: boolean,
  onOpenClip: (row: QueueClip) => void
) {
  const activeRef = React.useRef<Map<string, ActiveUpload>>(new Map())
  const retainedThumbsRef = React.useRef<Map<string, string>>(new Map())
  const [, bumpState] = React.useReducer((n: number) => n + 1, 0)
  const bump = React.useCallback(() => bumpState(), [])

  const { data: serverQueueData, stream } = useUploadQueueQuery({
    enabled: queueOpen,
  })
  const serverQueueHydrated = serverQueueData !== undefined
  const queueStreamFailed = stream.initialError
  const serverQueue = React.useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData]
  )

  React.useEffect(() => {
    return () => {
      for (const active of activeRef.current.values()) {
        URL.revokeObjectURL(active.thumbUrl)
      }
      activeRef.current.clear()
      for (const url of retainedThumbsRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      retainedThumbsRef.current.clear()
    }
  }, [])

  useServerQueueSync(serverQueue, activeRef, retainedThumbsRef, bump)
  const runUpload = useRunUpload(activeRef, retainedThumbsRef, bump)
  const cancelRow = useCancelRow(activeRef, retainedThumbsRef, bump)
  const releaseRetainedThumb = React.useCallback(
    (clipId: string) => {
      const retained = retainedThumbsRef.current.get(clipId)
      if (!retained) return
      URL.revokeObjectURL(retained)
      retainedThumbsRef.current.delete(clipId)
      bump()
    },
    [bump]
  )
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
          onDismiss:
            row.status === "ready"
              ? () => {
                  releaseRetainedThumb(row.id)
                  dismiss(row.id)
                }
              : undefined,
          thumbFallbackUrl: retainedThumbsRef.current.get(row.id),
          onThumbLoad: () => releaseRetainedThumb(row.id),
        })
      )
    return [...fromLocal, ...fromServer]
  }, [
    serverQueue,
    cancelRow,
    onOpenClip,
    dismissed,
    dismiss,
    releaseRetainedThumb,
  ])

  const activeCount = queue.filter(
    (q) => q.status !== "published" && q.status !== "failed"
  ).length

  const clearCompleted = React.useCallback(() => {
    const readyIds = serverQueue
      .filter((r) => r.status === "ready" && !dismissed.has(r.id))
      .map((r) => r.id)
    for (const id of readyIds) {
      releaseRetainedThumb(id)
    }
    dismissMany(readyIds)
  }, [serverQueue, dismissed, dismissMany, releaseRetainedThumb])

  return {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
    isQueueLoading: queueOpen && !serverQueueHydrated && !queueStreamFailed,
    isQueueUnavailable: queueOpen && !serverQueueHydrated && queueStreamFailed,
  }
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
      <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            "right-4 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+1rem)] left-4",
            "h-auto max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-2rem)]",
            "rounded-2xl border p-3",
            "alloy-glass"
          )}
          style={queueGlassStyle}
          aria-describedby={undefined}
        >
          {content}
        </SheetContent>
      </Sheet>
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

function clipLinkFor(row: QueueClip): string {
  return `${window.location.origin}/g/${row.gameSlug}/c/${row.id}`
}

async function copyClipLink(row: QueueClip): Promise<void> {
  try {
    await navigator.clipboard.writeText(clipLinkFor(row))
    toast.success("Link copied")
  } catch {
    toast.error("Couldn't copy link")
  }
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
