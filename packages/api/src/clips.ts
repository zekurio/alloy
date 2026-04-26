import type { ApiContext } from "./client"
import type {
  ClipFeedParams,
  ClipLikeState,
  ClipRow,
  InitiateClipInput,
  InitiateClipResponse,
  UpdateClipInput,
  UploadTicket,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

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

export function clipStreamUrl(
  clipId: string,
  variantId?: string,
  origin?: string
): string {
  const path = `/api/clips/${clipId}/stream`
  if (!variantId) return withOrigin(path, origin)

  const search = new URLSearchParams({ variant: variantId }).toString()
  return withOrigin(`${path}?${search}`, origin)
}

export function clipThumbnailUrl(clipId: string, origin?: string): string {
  return withOrigin(`/api/clips/${clipId}/thumbnail`, origin)
}

export function clipDownloadUrl(
  clipId: string,
  variantId: string,
  origin?: string
): string {
  const search = new URLSearchParams({ variant: variantId }).toString()
  return withOrigin(`/api/clips/${clipId}/download?${search}`, origin)
}

export function uploadToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(ticket.method, ticket.uploadUrl)
    xhr.withCredentials = false
    for (const [name, value] of Object.entries(ticket.headers)) {
      xhr.setRequestHeader(name, value)
    }
    if (!ticket.headers["Content-Type"]) {
      xhr.setRequestHeader("Content-Type", body.type)
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        let message = `${xhr.status} ${xhr.statusText}`
        try {
          const payload = JSON.parse(xhr.responseText) as { error?: string }
          if (payload.error) message = payload.error
        } catch {
          // Keep the status line when the upstream body isn't JSON.
        }
        reject(new Error(message))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"))
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true })
    }
    xhr.send(body)
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
  return readJsonOrThrow<ClipRow[]>(res)
}

async function fetchClipById(
  context: ApiContext,
  clipId: string,
  init?: RequestInit
): Promise<ClipRow> {
  const res = await context.request(clipPath(clipId), { init })
  return readJsonOrThrow<ClipRow>(res)
}

async function initiateClip(
  context: ApiContext,
  input: InitiateClipInput
): Promise<InitiateClipResponse> {
  const res = await context.request("/api/clips/initiate", {
    method: "POST",
    json: input,
  })
  return readJsonOrThrow<InitiateClipResponse>(res)
}

async function finalizeClip(
  context: ApiContext,
  clipId: string
): Promise<ClipRow> {
  const res = await context.request(clipPath(clipId, "/finalize"), {
    method: "POST",
  })
  return readJsonOrThrow<ClipRow>(res)
}

async function deleteClip(context: ApiContext, clipId: string): Promise<void> {
  const res = await context.request(clipPath(clipId), { method: "DELETE" })
  await readJsonOrThrow<{ deleted: true }>(res)
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
  return readJsonOrThrow<ClipRow>(res)
}

async function fetchLikeState(
  context: ApiContext,
  clipId: string
): Promise<{ liked: boolean }> {
  const res = await context.request(clipPath(clipId, "/like"))
  return readJsonOrThrow<{ liked: boolean }>(res)
}

async function setClipLike(
  context: ApiContext,
  clipId: string,
  liked: boolean
): Promise<ClipLikeState> {
  const res = await context.request(clipPath(clipId, "/like"), {
    method: liked ? "POST" : "DELETE",
  })
  return readJsonOrThrow<ClipLikeState>(res)
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
    fetchById: (clipId: string, init?: RequestInit) =>
      fetchClipById(context, clipId, init),
    initiate: (input: InitiateClipInput) => initiateClip(context, input),
    finalize: (clipId: string) => finalizeClip(context, clipId),
    delete: (clipId: string) => deleteClip(context, clipId),
    update: (clipId: string, input: UpdateClipInput) =>
      updateClip(context, clipId, input),
    fetchLikeState: (clipId: string) => fetchLikeState(context, clipId),
    like: (clipId: string) => setClipLike(context, clipId, true),
    unlike: (clipId: string) => setClipLike(context, clipId, false),
    recordView: (clipId: string) => recordClipView(context, clipId),
  }
}
