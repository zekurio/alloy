import { isAbortError, type QueueClip } from "@alloy/api"
import { stableHue } from "@alloy/contracts"
import { hashKey, type QueryClient } from "@tanstack/react-query"
import { createStore, type StoreApi } from "zustand/vanilla"

import { clipKeys, invalidateClipCaches } from "@/lib/clip-queries"
import { removeUploadQueueClip } from "@/lib/clip-queue-stream"
import { randomId } from "@/lib/random-id"

import {
  type DeferredPublishPayload,
  isDeferredPublishPayload,
  type PublishClipInput,
  type PublishPayload,
} from "./new-clip-helpers"
import type { PublishClipFn } from "./upload-flow-context"
import {
  clearLocalCaptureClipLink,
  deleteUploadClipBestEffort,
  linkLocalCaptureToClip,
  markUploadFailedBestEffort,
  startUpload,
  type UploadAttempt,
} from "./upload-flow-runner"
import { type ActiveUpload, canRetryActiveUpload } from "./upload-queue-mapping"
import { revokeUploadThumbUrl } from "./upload-thumbnail-urls"

export interface UploadQueueStoreState {
  /** Uploads this page still owns, by local id, until the server row takes over. */
  active: ReadonlyMap<string, ActiveUpload>
  /** Local thumbnails kept per clip until the server's own thumbnail loads. */
  retainedThumbs: ReadonlyMap<string, string>
  publishClip: PublishClipFn
  retryUpload: (localId: string) => void
  cancelRow: (localId: string | null, clipId: string | null) => void
  releaseRetainedThumb: (clipId: string) => void
  /**
   * Follows the server queue in the query cache, handing finished local
   * uploads over to their server rows. The returned stop also drops every
   * local upload, so a signed-out or unmounted flow leaves nothing running.
   */
  attach: () => () => void
}

export type UploadQueueStore = StoreApi<UploadQueueStoreState>

export function hasUploadInFlight(
  active: ReadonlyMap<string, ActiveUpload>,
): boolean {
  for (const entry of active.values()) {
    if (entry.status !== "error") return true
  }
  return false
}

export function createUploadQueueStore(
  queryClient: QueryClient,
  invalidateClips: () => void,
): UploadQueueStore {
  return createStore<UploadQueueStoreState>()((set, get) => {
    const patchActive = (localId: string, change: Partial<ActiveUpload>) => {
      const current = get().active.get(localId)
      if (!current) return
      set({
        active: new Map(get().active).set(localId, { ...current, ...change }),
      })
    }

    const removeActive = (localId: string) => {
      if (!get().active.has(localId)) return
      const active = new Map(get().active)
      active.delete(localId)
      set({ active })
    }

    const releaseRetained = (clipId: string) => {
      const retained = get().retainedThumbs.get(clipId)
      if (!retained) return
      revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
      const retainedThumbs = new Map(get().retainedThumbs)
      retainedThumbs.delete(clipId)
      set({ retainedThumbs })
    }

    // An attempt keeps the latest copy of its entry, so cleanup after a
    // cancel or teardown still sees the clip id the upload reserved.
    const track = (entry: ActiveUpload): UploadAttempt => {
      let latest = entry
      return {
        current: () => latest,
        update: (change) => {
          latest = { ...latest, ...change }
          patchActive(latest.localId, change)
        },
      }
    }

    const finishUpload = (attempt: UploadAttempt) => {
      const entry = attempt.current()
      const active = new Map(get().active)
      active.delete(entry.localId)
      if (entry.clipId && entry.thumbUrl) {
        set({
          active,
          retainedThumbs: new Map(get().retainedThumbs).set(
            entry.clipId,
            entry.thumbUrl,
          ),
        })
        return
      }
      revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
      set({ active })
    }

    const failUpload = (attempt: UploadAttempt, cause: unknown) => {
      const entry = attempt.current()
      if (isAbortError(cause)) {
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
        removeActive(entry.localId)
        if (entry.localCaptureId && entry.clipId) {
          void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
        }
        if (entry.serverClipCreated && entry.clipId) {
          void deleteUploadClipBestEffort(entry.clipId, "upload abort").then(
            (deleted) => {
              if (deleted) invalidateClips()
            },
          )
        }
        return
      }

      if (entry.serverClipCreated && entry.clipId) {
        void markUploadFailedBestEffort(entry.clipId).finally(invalidateClips)
      } else if (entry.localCaptureId && entry.clipId) {
        void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
      }
      attempt.update({
        status: "error",
        errorMessage: cause instanceof Error ? cause.message : "Upload failed",
      })
    }

    const beginUpload = async (
      attempt: UploadAttempt,
      payload: PublishPayload,
    ) => {
      // Keep the prepared payload so local failures can retry without
      // reopening the editor or preparing the media again.
      attempt.update({
        preparedPayload: payload,
        title: payload.title,
        hue: stableHue(payload.title),
        bytesTotal: payload.sizeBytes,
        bytesLoaded: 0,
        localCaptureId:
          payload.localCaptureId ?? attempt.current().localCaptureId,
        status: "initiating",
      })

      const { clipId, completion } = await startUpload(
        payload,
        attempt,
        invalidateClips,
      )
      void completion.then(
        () => finishUpload(attempt),
        (cause) => failUpload(attempt, cause),
      )
      return clipId
    }

    const prepareUpload = (
      attempt: UploadAttempt,
      prepare: DeferredPublishPayload["prepare"],
    ) => {
      const entry = attempt.current()
      if (entry.localCaptureId && entry.clipId) {
        void linkLocalCaptureToClip(entry.localCaptureId, entry.clipId)
      }
      const signal = entry.abort.signal
      void prepare(signal)
        .then((payload) => {
          signal.throwIfAborted()
          return beginUpload(attempt, payload)
        })
        .catch((cause: unknown) => failUpload(attempt, cause))
    }

    const cancelLocalUpload = (localId: string) => {
      const entry = get().active.get(localId)
      if (!entry) return
      entry.abort.abort()
      if (entry.status === "uploading") return

      revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
      removeActive(localId)
      if (entry.localCaptureId && entry.clipId) {
        void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
      }
      if (entry.serverClipCreated && entry.clipId) {
        void deleteUploadClipBestEffort(entry.clipId, "local cancel").then(
          (deleted) => {
            if (deleted) invalidateClipCaches(queryClient)
          },
        )
      }
    }

    const readyNotified = new Set<string>()
    const thumbNotified = new Set<string>()

    const syncServerQueue = (serverQueue: QueueClip[]) => {
      handoffServerOwnedUploads(serverQueue)
      let clips = false
      let published = false
      for (const row of serverQueue) {
        if (row.hasThumb && !thumbNotified.has(row.id)) {
          thumbNotified.add(row.id)
          clips = true
        }
        if (row.status === "ready" && !readyNotified.has(row.id)) {
          readyNotified.add(row.id)
          clips = true
          published = true
        }
      }
      if (published) invalidateClipCaches(queryClient)
      else if (clips) invalidateClips()
    }

    const handoffServerOwnedUploads = (serverQueue: QueueClip[]) => {
      const rowsById = new Map(serverQueue.map((row) => [row.id, row]))
      const active = new Map(get().active)
      const retainedThumbs = new Map(get().retainedThumbs)
      let changed = false
      for (const [localId, entry] of active) {
        if (!entry.clipId) continue
        const row = rowsById.get(entry.clipId)
        // Failed rows remain local because the active entry owns the retry
        // payload.
        if (
          !row ||
          (row.status !== "processing" && row.status !== "ready") ||
          entry.status === "uploading"
        ) {
          continue
        }
        const retained = retainedThumbs.get(entry.clipId)
        if (retained && retained !== entry.thumbUrl) {
          revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
        }
        if (entry.thumbUrl) retainedThumbs.set(entry.clipId, entry.thumbUrl)
        active.delete(localId)
        changed = true
      }
      if (changed) set({ active, retainedThumbs })
    }

    const dispose = () => {
      for (const entry of get().active.values()) {
        // Stop the transfer too: a detached XHR keeps sending bytes for a
        // clip no queue can show, cancel or finalize any more.
        entry.abort.abort()
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
      }
      for (const url of get().retainedThumbs.values()) {
        revokeUploadThumbUrl(url, "retained upload thumbnail URL")
      }
      set({ active: new Map(), retainedThumbs: new Map() })
    }

    return {
      active: new Map(),
      retainedThumbs: new Map(),

      publishClip: async (input: PublishClipInput) => {
        const entry = createActiveUpload(input)
        set({ active: new Map(get().active).set(entry.localId, entry) })
        const attempt = track(entry)

        if (isDeferredPublishPayload(input)) {
          prepareUpload(attempt, input.prepare)
          return { clipId: entry.clipId ?? null }
        }

        try {
          return { clipId: await beginUpload(attempt, input) }
        } catch (cause) {
          failUpload(attempt, cause)
          if (isAbortError(cause)) return { clipId: null }
          throw cause
        }
      },

      retryUpload: (localId) => {
        const entry = get().active.get(localId)
        if (!entry || !canRetryActiveUpload(entry)) return
        const attempt = track(entry)
        if (!entry.preparedPayload) {
          // Preparation failed before a server clip existed, so the original
          // clip id is still unused and the prepare step can simply run again.
          if (!entry.prepare) return
          attempt.update({
            abort: new AbortController(),
            errorMessage: undefined,
            status: "preparing",
          })
          prepareUpload(attempt, entry.prepare)
          return
        }
        const payload = entry.preparedPayload
        // Initiation rejects duplicate client ids, so retry with a fresh clip
        // id after dropping any server clip created by the failed attempt.
        const staleClipId = entry.serverClipCreated ? entry.clipId : undefined
        attempt.update({
          abort: new AbortController(),
          clipId: undefined,
          serverClipCreated: false,
          errorMessage: undefined,
          bytesLoaded: 0,
          status: "initiating",
        })
        if (staleClipId) {
          void deleteUploadClipBestEffort(staleClipId, "upload retry")
        }
        void beginUpload(attempt, payload).catch((cause: unknown) =>
          failUpload(attempt, cause),
        )
      },

      cancelRow: (localId, clipId) => {
        if (localId) cancelLocalUpload(localId)
        if (!clipId) return
        releaseRetained(clipId)
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          removeUploadQueueClip(old, clipId),
        )
        void deleteUploadClipBestEffort(clipId, "queue cancel").then(
          (deleted) => {
            if (deleted) invalidateClipCaches(queryClient)
          },
        )
      },

      releaseRetainedThumb: releaseRetained,

      attach: () => {
        readyNotified.clear()
        thumbNotified.clear()
        const queueKey = clipKeys.queue()
        const queueHash = hashKey(queueKey)
        let synced: QueueClip[] | undefined
        const sync = () => {
          const serverQueue = queryClient.getQueryData<QueueClip[]>(queueKey)
          if (!serverQueue || serverQueue === synced) return
          synced = serverQueue
          if (serverQueue.length > 0) syncServerQueue(serverQueue)
        }
        sync()
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.type === "updated" && event.query.queryHash === queueHash) {
            sync()
          }
        })
        return () => {
          unsubscribe()
          dispose()
        }
      },
    }
  })
}

function createActiveUpload(input: PublishClipInput): ActiveUpload {
  const deferred = isDeferredPublishPayload(input)
  return {
    localId: `local-${Math.random().toString(36).slice(2)}`,
    clipId: deferred ? randomId() : undefined,
    localCaptureId: input.localCaptureId,
    title: input.title,
    hue: stableHue(input.title),
    bytesTotal: input.sizeBytes,
    bytesLoaded: 0,
    status: deferred ? "preparing" : "initiating",
    abort: new AbortController(),
    thumbUrl: deferred ? input.thumbUrl : null,
    thumbBlurHash: deferred ? input.thumbBlurHash : null,
    prepare: deferred ? input.prepare : undefined,
  }
}
