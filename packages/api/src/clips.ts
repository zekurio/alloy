import type { ApiContext } from "./client"
import type {
  ClipFeedParams,
  ClipLikeState,
  ClipRow,
  InitiateClipInput,
  InitiateClipResponse,
  UpdateClipInput,
  UploadTicket,
  QueueClip,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import {
  validateBooleanFlag,
  validateClipLikeState,
  validateClipRow,
  validateClipRows,
  validateInitiateClipResponse,
  validateQueueClips,
} from "./contract-validators"

const UPLOAD_TIMEOUT_GRACE_MS = 30_000
const MIN_UPLOAD_TIMEOUT_MS = 30_000

export { ACCEPTED_CLIP_CONTENT_TYPES } from "@workspace/contracts"
export type {
  AcceptedContentType,
  ClipEncodedVariant,
  ClipFeedParams,
  ClipFeedSort,
  ClipFeedWindow,
  ClipGameRef,
  ClipLikeState,
  ClipMentionRef,
  ClipPrivacy,
  ClipRow,
  ClipStatus,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  UpdateClipInput,
  UploadTicket,
} from "@workspace/contracts"

function withOrigin(path: string, origin?: string): string {
  if (!origin) return path
  return new URL(path, origin).toString()
}

function publicClipPath(clipId: string, suffix: string): string {
  return `/api/clips/${encodeURIComponent(clipId)}${suffix}`
}

export function clipStreamUrl(
  clipId: string,
  variantId?: string,
  origin?: string
): string {
  const path = publicClipPath(clipId, "/stream")
  if (!variantId) return withOrigin(path, origin)

  const search = new URLSearchParams({ variant: variantId }).toString()
  return withOrigin(`${path}?${search}`, origin)
}

export function clipThumbnailUrl(clipId: string, origin?: string): string {
  return withOrigin(publicClipPath(clipId, "/thumbnail"), origin)
}

export function clipDownloadUrl(
  clipId: string,
  variantId: string,
  origin?: string
): string {
  const search = new URLSearchParams({ variant: variantId }).toString()
  return withOrigin(`${publicClipPath(clipId, "/download")}?${search}`, origin)
}

export function uploadToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const abortUpload = () => xhr.abort()
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener("abort", abortUpload)
      fn()
    }

    try {
      xhr.open(ticket.method, ticket.uploadUrl)
      xhr.withCredentials = false
      for (const [name, value] of Object.entries(ticket.headers)) {
        xhr.setRequestHeader(name, value)
      }
      const hasContentType = Object.keys(ticket.headers).some(
        (name) => name.toLowerCase() === "content-type"
      )
      if (!hasContentType && body.type) {
        xhr.setRequestHeader("Content-Type", body.type)
      }
    } catch (err) {
      settle(() =>
        reject(
          err instanceof Error
            ? err
            : new Error("Could not prepare upload request")
        )
      )
      return
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(resolve)
      } else {
        let message = `${xhr.status} ${xhr.statusText}`
        try {
          const payload = JSON.parse(xhr.responseText) as { error?: string }
          if (payload.error) message = payload.error
        } catch {
          // Keep the status line when the upstream body isn't JSON.
        }
        settle(() => reject(new Error(message)))
      }
    }
    xhr.onerror = () =>
      settle(() => reject(new Error("Network error during upload")))
    xhr.ontimeout = () => settle(() => reject(new Error("Upload timed out")))
    xhr.onabort = () =>
      settle(() => reject(new DOMException("Upload aborted", "AbortError")))
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener("abort", abortUpload, { once: true })
    }
    try {
      xhr.timeout = Math.max(
        MIN_UPLOAD_TIMEOUT_MS,
        ticket.expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS
      )
      xhr.send(body)
    } catch (err) {
      settle(() =>
        reject(err instanceof Error ? err : new Error("Could not start upload"))
      )
    }
  })
}

function clipPath(clipId: string, suffix = "") {
  return `/api/clips/${encodeURIComponent(clipId)}${suffix}`
}

async function fetchClips(
  context: ApiContext,
  params: ClipFeedParams = {}
): Promise<ClipRow[]> {
  const query: Record<string, string> = {}
  if (params.window) query.window = params.window
  if (params.sort) query.sort = params.sort
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor

  const res = await context.request("/api/clips", { query })
  return readJsonOrThrow(res, validateClipRows)
}

async function fetchUploadQueue(context: ApiContext): Promise<QueueClip[]> {
  const res = await context.request("/api/clips/queue")
  return readJsonOrThrow(res, validateQueueClips)
}

async function fetchClipById(
  context: ApiContext,
  clipId: string,
  init?: RequestInit
): Promise<ClipRow> {
  const res = await context.request(clipPath(clipId), { init })
  return readJsonOrThrow(res, validateClipRow)
}

async function initiateClip(
  context: ApiContext,
  input: InitiateClipInput
): Promise<InitiateClipResponse> {
  const res = await context.request("/api/clips/initiate", {
    method: "POST",
    json: input,
  })
  return readJsonOrThrow(res, validateInitiateClipResponse)
}

async function finalizeClip(
  context: ApiContext,
  clipId: string
): Promise<ClipRow> {
  const res = await context.request(clipPath(clipId, "/finalize"), {
    method: "POST",
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function markUploadFailed(
  context: ApiContext,
  clipId: string
): Promise<void> {
  const res = await context.request(clipPath(clipId, "/fail"), {
    method: "POST",
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "success")
}

async function deleteClip(context: ApiContext, clipId: string): Promise<void> {
  const res = await context.request(clipPath(clipId), { method: "DELETE" })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "deleted")
}

async function updateClip(
  context: ApiContext,
  clipId: string,
  input: UpdateClipInput
): Promise<ClipRow> {
  const res = await context.request(clipPath(clipId), {
    method: "PATCH",
    json: input,
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function fetchLikeState(
  context: ApiContext,
  clipId: string
): Promise<{ liked: boolean }> {
  const res = await context.request(clipPath(clipId, "/like"))
  const response = validateBooleanFlag(
    await readJsonOrThrow<unknown>(res),
    "liked"
  )
  return { liked: response.liked }
}

async function setClipLike(
  context: ApiContext,
  clipId: string,
  liked: boolean
): Promise<ClipLikeState> {
  const res = await context.request(clipPath(clipId, "/like"), {
    method: liked ? "POST" : "DELETE",
  })
  return readJsonOrThrow(res, validateClipLikeState)
}

async function recordClipView(
  context: ApiContext,
  clipId: string
): Promise<void> {
  try {
    await context.request(clipPath(clipId, "/view"), { method: "POST" })
  } catch {
    // View tracking is best-effort.
  }
}

export function createClipsApi(context: ApiContext) {
  return {
    fetch: (params: ClipFeedParams = {}) => fetchClips(context, params),
    fetchQueue: () => fetchUploadQueue(context),
    fetchById: (clipId: string, init?: RequestInit) =>
      fetchClipById(context, clipId, init),
    initiate: (input: InitiateClipInput) => initiateClip(context, input),
    finalize: (clipId: string) => finalizeClip(context, clipId),
    markUploadFailed: (clipId: string) => markUploadFailed(context, clipId),
    delete: (clipId: string) => deleteClip(context, clipId),
    update: (clipId: string, input: UpdateClipInput) =>
      updateClip(context, clipId, input),
    fetchLikeState: (clipId: string) => fetchLikeState(context, clipId),
    like: (clipId: string) => setClipLike(context, clipId, true),
    unlike: (clipId: string) => setClipLike(context, clipId, false),
    recordView: (clipId: string) => recordClipView(context, clipId),
  }
}
