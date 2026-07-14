import { stableHue } from "@alloy/ui/lib/stable-hash"
import { useCallback } from "react"
import type { MutableRefObject } from "react"

import { useInvalidateClips } from "@/lib/clip-queries"

import {
  isDeferredPublishPayload,
  type PublishClipInput,
  type PublishPayload,
} from "./new-clip-helpers"
import {
  clearLocalCaptureClipLink,
  deleteUploadClipBestEffort,
  linkLocalCaptureToClip,
  markUploadFailedBestEffort,
  startUpload,
} from "./upload-flow-runner"
import type { ActiveUpload } from "./upload-queue-mapping"
import { revokeUploadThumbUrl } from "./upload-thumbnail-urls"

export function useRunUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const invalidateClips = useInvalidateClips()
  const finishUpload = useFinishActiveUpload(activeRef, retainedThumbsRef, bump)
  const failUpload = useFailActiveUpload(activeRef, bump, invalidateClips)
  const beginUpload = useBeginActiveUpload(
    bump,
    invalidateClips,
    finishUpload,
    failUpload,
  )
  return {
    runUpload: useStartActiveUpload(activeRef, bump, beginUpload, failUpload),
    retryUpload: useRetryActiveUpload(activeRef, bump, beginUpload, failUpload),
  }
}

function useFinishActiveUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  return useCallback(
    (entry: ActiveUpload) => {
      if (entry.clipId && entry.thumbUrl) {
        retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
      } else {
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
      }
      activeRef.current.delete(entry.localId)
      bump()
    },
    [activeRef, retainedThumbsRef, bump],
  )
}

function useFailActiveUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void,
  invalidateClips: () => void,
) {
  return useCallback(
    (entry: ActiveUpload, err: unknown) => {
      if ((err as Error).name === "AbortError") {
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
        activeRef.current.delete(entry.localId)
        bump()
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
      entry.status = "error"
      entry.errorMessage = (err as Error).message
      bump()
    },
    [activeRef, bump, invalidateClips],
  )
}

function useBeginActiveUpload(
  bump: () => void,
  invalidateClips: () => void,
  finishUpload: (entry: ActiveUpload) => void,
  failUpload: (entry: ActiveUpload, err: unknown) => void,
) {
  return useCallback(
    async (entry: ActiveUpload, payload: PublishPayload) => {
      // Keep the prepared payload so local failures can retry without reopening
      // the editor or preparing the media again.
      entry.preparedPayload = payload
      entry.title = payload.title
      entry.hue = stableHue(payload.title)
      entry.bytesTotal = payload.sizeBytes
      entry.bytesLoaded = 0
      entry.localCaptureId = payload.localCaptureId ?? entry.localCaptureId
      entry.status = "initiating"
      bump()

      const { clipId, completion } = await startUpload(
        payload,
        entry,
        bump,
        invalidateClips,
      )
      void completion.then(
        () => finishUpload(entry),
        (err) => failUpload(entry, err),
      )
      return clipId
    },
    [bump, invalidateClips, finishUpload, failUpload],
  )
}

function useStartActiveUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void,
  beginUpload: (
    entry: ActiveUpload,
    payload: PublishPayload,
  ) => Promise<string>,
  failUpload: (entry: ActiveUpload, err: unknown) => void,
) {
  return useCallback(
    async (input: PublishClipInput) => {
      const entry = createActiveUpload(input)
      activeRef.current.set(entry.localId, entry)
      bump()

      if (
        isDeferredPublishPayload(input) &&
        entry.localCaptureId &&
        entry.clipId
      ) {
        void linkLocalCaptureToClip(entry.localCaptureId, entry.clipId)
      }
      if (isDeferredPublishPayload(input)) {
        void input
          .prepare(entry.abort.signal)
          .then((payload) => {
            entry.abort.signal.throwIfAborted()
            return beginUpload(entry, payload)
          })
          .catch((err: unknown) => failUpload(entry, err))
        return { clipId: entry.clipId ?? null }
      }

      try {
        return { clipId: await beginUpload(entry, input) }
      } catch (err) {
        failUpload(entry, err)
        if ((err as Error).name === "AbortError") return { clipId: null }
        throw err
      }
    },
    [activeRef, bump, beginUpload, failUpload],
  )
}

function createActiveUpload(input: PublishClipInput): ActiveUpload {
  const deferred = isDeferredPublishPayload(input)
  return {
    localId: `local-${Math.random().toString(36).slice(2)}`,
    clipId: deferred ? crypto.randomUUID() : undefined,
    localCaptureId: input.localCaptureId,
    title: input.title,
    hue: stableHue(input.title),
    bytesTotal: input.sizeBytes,
    bytesLoaded: 0,
    status: deferred ? "preparing" : "initiating",
    abort: new AbortController(),
    thumbUrl: deferred ? input.thumbUrl : null,
    thumbBlurHash: deferred ? input.thumbBlurHash : null,
  }
}

function useRetryActiveUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void,
  beginUpload: (
    entry: ActiveUpload,
    payload: PublishPayload,
  ) => Promise<string>,
  failUpload: (entry: ActiveUpload, err: unknown) => void,
) {
  return useCallback(
    (localId: string) => {
      const entry = activeRef.current.get(localId)
      if (!entry || entry.status !== "error" || !entry.preparedPayload) return
      const payload = entry.preparedPayload
      // Initiation rejects duplicate client ids, so retry with a fresh clip id
      // after dropping any server clip created by the failed attempt.
      const staleClipId = entry.serverClipCreated ? entry.clipId : undefined
      entry.abort = new AbortController()
      entry.clipId = undefined
      entry.serverClipCreated = false
      entry.errorMessage = undefined
      entry.bytesLoaded = 0
      entry.status = "initiating"
      bump()
      if (staleClipId) {
        void deleteUploadClipBestEffort(staleClipId, "upload retry")
      }
      void beginUpload(entry, payload).catch((err: unknown) =>
        failUpload(entry, err),
      )
    },
    [activeRef, bump, beginUpload, failUpload],
  )
}
