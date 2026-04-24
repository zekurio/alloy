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

export function createClipsApi(context: ApiContext) {
  return {
    async fetch(params: ClipFeedParams = {}): Promise<ClipRow[]> {
      const query: Record<string, string> = {}
      if (params.window) query.window = params.window
      if (params.sort) query.sort = params.sort
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.cursor) query.cursor = params.cursor

      const res = await context.request("/api/clips", { query })
      return readJsonOrThrow<ClipRow[]>(res)
    },

    async fetchById(clipId: string, init?: RequestInit): Promise<ClipRow> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}`,
        { init }
      )
      return readJsonOrThrow<ClipRow>(res)
    },

    async initiate(input: InitiateClipInput): Promise<InitiateClipResponse> {
      const res = await context.request("/api/clips/initiate", {
        method: "POST",
        json: input,
      })
      return readJsonOrThrow<InitiateClipResponse>(res)
    },

    async finalize(clipId: string): Promise<ClipRow> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}/finalize`,
        { method: "POST" }
      )
      return readJsonOrThrow<ClipRow>(res)
    },

    async delete(clipId: string): Promise<void> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}`,
        { method: "DELETE" }
      )
      await readJsonOrThrow<{ deleted: true }>(res)
    },

    async update(clipId: string, input: UpdateClipInput): Promise<ClipRow> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}`,
        {
          method: "PATCH",
          json: input,
        }
      )
      return readJsonOrThrow<ClipRow>(res)
    },

    async fetchLikeState(clipId: string): Promise<{ liked: boolean }> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}/like`
      )
      return readJsonOrThrow<{ liked: boolean }>(res)
    },

    async like(clipId: string): Promise<ClipLikeState> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}/like`,
        { method: "POST" }
      )
      return readJsonOrThrow<ClipLikeState>(res)
    },

    async unlike(clipId: string): Promise<ClipLikeState> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}/like`,
        { method: "DELETE" }
      )
      return readJsonOrThrow<ClipLikeState>(res)
    },

    async recordView(clipId: string): Promise<void> {
      try {
        await context.request(`/api/clips/${encodeURIComponent(clipId)}/view`, {
          method: "POST",
        })
      } catch {
        // View tracking is best-effort.
      }
    },
  }
}
