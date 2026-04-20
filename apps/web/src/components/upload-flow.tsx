import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { UploadIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "../lib/auth-client"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "../lib/clip-queries"
import {
  clipThumbnailUrl,
  deleteClip,
  finalizeClip,
  initiateClip,
  uploadToTicket,
  type QueueClip,
} from "../lib/clips-api"
import type { PublishPayload } from "./upload-new-clip-modal"
import type { QueueItem, QueueItemStatus } from "./upload-queue-modal"

// The upload modals pull in heavy form/timeline/dialog machinery that isn't
// needed until the FAB is opened. Splitting them into their own chunks keeps
// the initial home-route bundle smaller.
const loadUploadQueueModal = () => import("./upload-queue-modal")
const UploadQueueModal = React.lazy(() =>
  loadUploadQueueModal().then((m) => ({ default: m.UploadQueueModal }))
)
const loadUploadNewClipModal = () => import("./upload-new-clip-modal")
const UploadNewClipModal = React.lazy(() =>
  loadUploadNewClipModal().then((m) => ({
    default: m.UploadNewClipModal,
  }))
)

/**
 * In-flight upload tracked locally in the browser. The XHR's progress
 * fires faster than any server poll could, so we keep these in a Map
 * and merge them with the server-fed queue rows in `mergeQueue()`.
 *
 * Lifecycle:
 *   `initiating` — POST /api/clips/initiate is in flight
 *   `uploading`  — XHR is streaming bytes at the storage endpoint
 *   `finalizing` — POST /api/clips/:id/finalize is in flight
 *   `error`      — terminal local failure (initiate/upload/finalize threw)
 *
 * Once finalize returns, the row exists server-side as `uploaded` and
 * the next poll will pick it up. We then drop the local entry and let
 * the server row drive the queue display through `encoding → ready`.
 */
interface ActiveUpload {
  localId: string
  clipId?: string
  title: string
  filename: string
  hue: number
  bytesTotal: number
  bytesLoaded: number
  status: "initiating" | "uploading" | "finalizing" | "error"
  errorMessage?: string
  abort: AbortController
  /**
   * Object URL over the client-captured small thumb blob. Lives for the
   * lifetime of the local entry and gets revoked when we drop it from
   * `activeRef` so we don't leak blob handles.
   */
  thumbUrl: string
}

/** Stable hash → 0–360 hue for the queue row's gradient placeholder. */
function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return h % 360
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Top-level upload UX: floating FAB in the bottom-right plus the two
 * modals it drives.
 *
 *   FAB  ──▶  UploadQueueModal  ──▶  UploadNewClipModal
 *
 * Owns the active-upload map and the server-poll cache, and exposes
 * callbacks (`onCancel`, `onView`) to the rendered queue rows. The two
 * modals stay mounted lazily so the initial home-route bundle isn't on
 * the hook for them.
 */
export function UploadFlow() {
  const { data: session } = useSession()
  if (!session) return null

  return <AuthedUploadFlow />
}

function AuthedUploadFlow() {
  const [queueOpen, setQueueOpen] = React.useState(false)
  const [newClipOpen, setNewClipOpen] = React.useState(false)
  // Mount each lazy modal independently so the first queue open doesn't
  // also pay to download + initialise the heavier new-clip editor chunk.
  const [queueModalMounted, setQueueModalMounted] = React.useState(false)
  const [newClipModalMounted, setNewClipModalMounted] = React.useState(false)

  // Local in-flight uploads. We use a ref + a force-render counter
  // because the XHR `onProgress` fires often and we want updates to be
  // O(1) on the map, not O(n) state copies.
  const activeRef = React.useRef<Map<string, ActiveUpload>>(new Map())
  const [, bump] = React.useReducer((n: number) => n + 1, 0)

  // Server-side queue rows come from TanStack Query: the hook polls
  // every 2s while the modal is open (matching the old setInterval),
  // retries on focus, and is disabled once the modal closes so background
  // tabs go quiet. `clipKeys.queue()` is the same cache entry the upload
  // path invalidates on cancel — see `cancelRow` below.
  const queryClient = useQueryClient()
  const invalidateClips = useInvalidateClips()
  const { data: serverQueueData } = useUploadQueueQuery({ enabled: queueOpen })
  const serverQueue = React.useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData]
  )

  // Once a finalize completes, the server row will replace the local
  // entry on the next poll. Drop the local entry as soon as we see the
  // matching clipId arrive in `serverQueue` so the row doesn't appear
  // twice for one tick.
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
  }, [serverQueue])

  // Hand-off: open the new-clip modal in the same tick we close the
  // queue. The shared backdrop (rendered below) stays visible across the
  // swap so the dimmed background no longer dips between the two
  // popups. Each popup still plays its own zoom/fade — but they no
  // longer compete because only one is mounted-and-open at a time
  // (queue is closing, new-clip is opening).
  const handleNewClip = React.useCallback(() => {
    setNewClipModalMounted(true)
    setQueueOpen(false)
    setNewClipOpen(true)
  }, [])

  const warmQueueModal = React.useCallback(() => {
    setQueueModalMounted(true)
    void loadUploadQueueModal()
  }, [])

  const handleFabClick = React.useCallback(() => {
    warmQueueModal()
    setQueueOpen(true)
  }, [warmQueueModal])

  React.useEffect(() => {
    if (!queueOpen) return
    const warmEditor = () => {
      setNewClipModalMounted(true)
      void loadUploadNewClipModal()
    }
    if (typeof window === "undefined") return
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warmEditor, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const timeout = globalThis.setTimeout(warmEditor, 250)
    return () => globalThis.clearTimeout(timeout)
  }, [queueOpen])

  /**
   * Run one initiate→upload→finalize cycle for a published payload.
   * Throws on terminal failure so the modal can surface the message in
   * its publish-error slot; the local map records non-throwing
   * intermediate states for the queue row.
   */
  const runUpload = React.useCallback(
    async (payload: PublishPayload) => {
      const localId = `local-${Math.random().toString(36).slice(2)}`
      const abort = new AbortController()
      // Wrap the small thumb blob in an object URL up front so the queue
      // row can paint it the moment the entry lands — no need to wait
      // for the server to surface /thumbnail. Revoked below when the
      // entry exits the local map.
      const thumbUrl = URL.createObjectURL(payload.thumbSmallBlob)
      const entry: ActiveUpload = {
        localId,
        title: payload.title,
        filename: payload.file.name,
        hue: hueFor(payload.title),
        bytesTotal: payload.sizeBytes,
        bytesLoaded: 0,
        status: "initiating",
        abort,
        thumbUrl,
      }
      activeRef.current.set(localId, entry)
      bump()

      try {
        const { clipId, ticket, thumbTicket, thumbSmallTicket } =
          await initiateClip({
            filename: payload.file.name,
            // The modal normalises the browser-reported MIME (e.g.
            // Firefox's `video/matroska` → `video/x-matroska`) before
            // we get here, so `payload.contentType` is already one of
            // the server's canonical values.
            contentType: payload.contentType,
            sizeBytes: payload.sizeBytes,
            title: payload.title,
            description: payload.description ?? undefined,
            gameId: payload.gameId ?? undefined,
            privacy: payload.privacy,
            // Only forward trim when the modal narrowed it — otherwise
            // we'd have the server store the full extent as a no-op trim.
            trimStartMs: payload.trimStartMs ?? undefined,
            trimEndMs: payload.trimEndMs ?? undefined,
            thumbSizeBytes: payload.thumbBlob.size,
            thumbSmallSizeBytes: payload.thumbSmallBlob.size,
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
          abort.signal
        )

        // Push the two thumbnails in parallel. They're tiny (tens of KB
        // each) so a dedicated progress channel isn't worth the UI churn —
        // we just gate finalize on both completing. A thumb failure is
        // terminal: the server's row already points at these keys and
        // finalize refuses to advance without the bytes on disk.
        await Promise.all([
          uploadToTicket(
            thumbTicket,
            payload.thumbBlob,
            () => undefined,
            abort.signal
          ),
          uploadToTicket(
            thumbSmallTicket,
            payload.thumbSmallBlob,
            () => undefined,
            abort.signal
          ),
        ])

        entry.status = "finalizing"
        bump()

        await finalizeClip(clipId)
        // Don't drop the entry here — the server-poll effect handles
        // hand-off to avoid a flicker between local-finalized and
        // server-uploaded.
        //
        // The clip isn't ready to play yet (encoder still has to run),
        // but `/api/clips` surfaces rows once status advances past
        // `pending`, so invalidating the clips caches now means the
        // next poll (or the home feed on return) sees the new row
        // without waiting for a page reload.
        void invalidateClips()
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          URL.revokeObjectURL(entry.thumbUrl)
          activeRef.current.delete(localId)
          bump()
          // Best-effort: if we already have a clipId, ask the server to
          // drop the row so the user can retry without the reaper
          // having to clean up.
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
    [invalidateClips]
  )

  /** Cancel a row — local in-flight upload OR a server-side row. */
  const cancelRow = React.useCallback(
    (localId: string | null, clipId: string | null) => {
      if (localId) {
        const entry = activeRef.current.get(localId)
        if (entry) {
          entry.abort.abort()
          // Some statuses don't have an in-flight XHR (initiating,
          // finalizing, error) — drop the entry directly.
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
        // Optimistically drop from the server snapshot so the row
        // disappears immediately; the next poll confirms. We patch the
        // cache directly (rather than invalidating) so there's no
        // flicker-while-refetching between here and the next 2s tick.
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          old ? old.filter((r) => r.id !== clipId) : old
        )
        void deleteClip(clipId)
          .then(() => invalidateClips())
          .catch(() => undefined)
      }
    },
    [invalidateClips, queryClient]
  )

  const handleNewClipOpenChange = React.useCallback((next: boolean) => {
    setNewClipOpen(next)
  }, [])

  // Build the merged queue: local entries first (newest in-flight), then
  // server rows that haven't been superseded by a local entry on the
  // same clipId.
  const queue: QueueItem[] = React.useMemo(() => {
    const localEntries = Array.from(activeRef.current.values())
    const localClipIds = new Set(
      localEntries.map((e) => e.clipId).filter((x): x is string => Boolean(x))
    )
    const fromLocal: QueueItem[] = localEntries.map((e) => {
      const pct =
        e.bytesTotal > 0
          ? Math.min(99, Math.floor((e.bytesLoaded / e.bytesTotal) * 100))
          : 0
      let status: QueueItemStatus
      let detail: string
      switch (e.status) {
        case "initiating":
          status = "queued"
          detail = "Reserving slot…"
          break
        case "uploading":
          status = "uploading"
          detail =
            e.bytesTotal > 0
              ? `${formatBytes(e.bytesLoaded)} / ${formatBytes(e.bytesTotal)}`
              : "Uploading…"
          break
        case "finalizing":
          status = "uploading"
          detail = "Finalizing…"
          break
        case "error":
          status = "failed"
          detail = e.errorMessage ?? "Upload failed"
          break
      }
      return {
        id: e.localId,
        title: e.title,
        status,
        progress: status === "uploading" ? pct : 0,
        detail,
        hue: e.hue,
        thumbUrl: e.thumbUrl,
        onCancel: () => cancelRow(e.localId, e.clipId ?? null),
      }
    })

    const fromServer: QueueItem[] = serverQueue
      // A local entry takes precedence — its progress is fresher than
      // the 2s poll could ever be.
      .filter((row) => !localClipIds.has(row.id))
      .map((row) => {
        let status: QueueItemStatus
        let detail: string
        switch (row.status) {
          case "pending":
            status = "queued"
            detail = "Awaiting upload"
            break
          case "uploaded":
            status = "queued"
            detail = "Queued for encoder"
            break
          case "encoding":
            status = "encoding"
            detail = `${row.encodeProgress}% encoded`
            break
          case "ready":
            status = "published"
            detail = "Ready"
            break
          case "failed":
            status = "failed"
            detail = row.failureReason ?? "Encoding failed"
            break
        }
        return {
          id: row.id,
          title: row.title,
          status,
          progress: status === "encoding" ? row.encodeProgress : 0,
          detail,
          hue: hueFor(row.id),
          // Thumbnail bytes land before /finalize advances the row past
          // `pending`, so any server-fed row can safely point at the
          // thumbnail endpoint. The endpoint 404s when the key is empty
          // and the gradient placeholder takes over via the img onError.
          thumbUrl: clipThumbnailUrl(row.id, "small"),
          onCancel: () => cancelRow(null, row.id),
          onView: () => {
            // Navigate to the clip page when the row reaches `published`.
            // Use a hard link until the home feed renders real clip ids.
            window.location.assign(`/clip/${row.slug}`)
          },
        }
      })

    return [...fromLocal, ...fromServer]
  }, [serverQueue, cancelRow])

  // The activeRef bumps trigger via the `bump` reducer; the memo above
  // closes over `activeRef.current` and so re-runs on every render that
  // bump caused. ESLint can't see that — silence the dep warning here
  // by using `React.useReducer`'s tick as a ref-render proxy.

  const activeCount = queue.filter(
    (q) => q.status !== "published" && q.status !== "failed"
  ).length

  const handlePublish = React.useCallback(
    async (payload: PublishPayload) => {
      // Close the new-clip modal immediately, open the queue, and let
      // the queue row render the upload progress. Throwing from runUpload
      // surfaces an error in the modal's publish slot — but only if the
      // modal is still open (it isn't, here), so we swallow it.
      setNewClipOpen(false)
      setQueueOpen(true)
      try {
        await runUpload(payload)
      } catch {
        // The error already lives on the queue row's `failed` status.
      }
    },
    [runUpload]
  )

  return (
    <>
      <FloatingUploadButton
        onClick={handleFabClick}
        activeCount={activeCount}
        onWarm={warmQueueModal}
      />
      {queueModalMounted || newClipModalMounted ? (
        <>
          {/*
           * Shared backdrop across both upload modals. Always-mounted
           * once the FAB is touched so its opacity transition handles
           * the fade — `pointer-events-none` when nothing is open lets
           * clicks pass through to the page. The per-modal overlay is
           * suppressed via `sharedOverlay` to prevent the mid-handoff
           * dip the user reported (queue's overlay would fade out a
           * few frames before the new-clip's faded back in).
           */}
          <SharedBackdrop visible={queueOpen || newClipOpen} />
          <React.Suspense fallback={null}>
            {queueModalMounted ? (
              <UploadQueueModal
                open={queueOpen}
                onOpenChange={setQueueOpen}
                queue={queue}
                onNewClip={handleNewClip}
                sharedOverlay
              />
            ) : null}
            {newClipModalMounted ? (
              <UploadNewClipModal
                open={newClipOpen}
                onOpenChange={handleNewClipOpenChange}
                onPublish={handlePublish}
                sharedOverlay
              />
            ) : null}
          </React.Suspense>
        </>
      ) : null}
    </>
  )
}

/**
 * Single dimmed backdrop shared across both upload modals. Mounted once
 * the user has opened the upload flow and never unmounts until the
 * `UploadFlow` itself does — toggling visibility with an opacity
 * transition lets the queue → new-clip handoff (and the publish flow's
 * new-clip → queue swap) keep the same dimmed background instead of
 * dipping back to the page between popups. `pointer-events-none` while
 * hidden so the page beneath stays interactive; while visible, clicks
 * land on the backdrop and bubble up to base-ui's outside-click
 * dismissal which still works without a per-dialog `Backdrop`.
 */
function SharedBackdrop({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden
      data-state={visible ? "open" : "closed"}
      className={cn(
        "fixed inset-0 z-50 bg-black/70",
        "supports-backdrop-filter:backdrop-blur-[4px]",
        "transition-opacity duration-100 ease-[var(--ease-out)]",
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    />
  )
}

/**
 * The bottom-right FAB. 48px accent-blue circle with an upload icon; a
 * tiny dark-bubble count badge surfaces unfinished uploads (uploading /
 * encoding / queued).
 */
function FloatingUploadButton({
  onClick,
  onWarm,
  activeCount,
}: {
  onClick: () => void
  onWarm: () => void
  activeCount: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onWarm}
      onFocus={onWarm}
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
        "hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-xl",
        "active:translate-y-0 active:bg-accent-active",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
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
