import { api } from "./api"
import { env } from "./env"

/**
 * Client wrappers for the /api/clips/* surface and the /storage/upload/*
 * companion route. The two-phase upload contract documented on the server
 * (`apps/server/src/routes/clips.ts`) shows up here as three distinct
 * calls: `initiateClip` reserves a row + ticket, `uploadToTicket` pushes
 * the bytes (XHR — fetch still has no upload progress), and `finalizeClip`
 * flips status='uploaded' and enqueues the encode job. The encoder takes
 * it the rest of the way — the queue endpoint polls for status.
 *
 * All wrappers throw on non-2xx so the upload state machine in
 * `upload-flow.tsx` can `try/catch` once and surface the message.
 */

// ─── Response shapes ───────────────────────────────────────────────────

export type ClipStatus = "pending" | "uploaded" | "encoding" | "ready" | "failed"
export type ClipPrivacy = "public" | "unlisted" | "private"

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
}

/**
 * Whitelisted upload MIME types — matches the server's
 * `ACCEPTED_CONTENT_TYPES` literal union exactly so the Hono RPC client's
 * inferred body shape accepts our input. Keep in sync with
 * `apps/server/src/routes/clips.ts`.
 */
export type AcceptedContentType =
  | "video/mp4"
  | "video/quicktime"
  | "video/x-matroska"
  | "video/webm"

export interface InitiateClipInput {
  filename: string
  contentType: AcceptedContentType
  sizeBytes: number
  title: string
  description?: string
  game?: string
  privacy?: ClipPrivacy
  /**
   * Optional trim window in ms against the source file. Both fields
   * must be set together (server enforces with a refine), or both
   * omitted to keep the full source.
   */
  trimStartMs?: number
  trimEndMs?: number
  /**
   * Byte sizes of the client-captured thumbnails. Both are required so
   * the server can bake the cap into the matching upload tickets — a
   * missing value would leak a token with an unbounded size budget.
   */
  thumbSizeBytes: number
  thumbSmallSizeBytes: number
}

export interface InitiateClipResponse {
  clipId: string
  slug: string
  ticket: UploadTicket
  thumbTicket: UploadTicket
  thumbSmallTicket: UploadTicket
}

export interface ClipRow {
  id: string
  slug: string
  authorId: string
  title: string
  description: string | null
  game: string | null
  privacy: ClipPrivacy
  storageKey: string
  contentType: string
  sizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  thumbKey: string | null
  thumbSmallKey: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  status: ClipStatus
  encodeProgress: number
  failureReason: string | null
  createdAt: string
  updatedAt: string
  /**
   * Author handle joined from `user.username`. Never null — clip rows FK
   * onto user with cascade delete, so by the time the row is visible in a
   * feed the author still exists.
   */
  authorUsername: string
  authorImage: string | null
}

export type ClipFeedWindow = "today" | "week" | "month"
export type ClipFeedSort = "top" | "recent"

export interface ClipFeedParams {
  window?: ClipFeedWindow
  sort?: ClipFeedSort
  limit?: number
  /** ISO timestamp — server returns rows with createdAt < cursor. */
  cursor?: string
}

/**
 * Slim shape returned by `/api/clips/queue` — only the columns the queue
 * modal actually paints. Keep this in sync with the `select()` in
 * `routes/clips.ts`.
 */
export interface QueueClip {
  id: string
  slug: string
  title: string
  status: ClipStatus
  encodeProgress: number
  failureReason: string | null
  createdAt: string
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

// ─── API wrappers ──────────────────────────────────────────────────────

/**
 * List clips from the home-feed endpoint. `window` scopes by recency,
 * `sort` picks between top-by-likes and newest-first, `cursor` lets the
 * recent tab page through batches of `limit` rows.
 *
 * The server caps `limit` at 100 — we leave it undefined here so the
 * default of 50 applies unless the caller explicitly bumps it.
 */
export async function fetchClips(params: ClipFeedParams = {}): Promise<ClipRow[]> {
  // Stringify each param the server expects as a string — zod coerces
  // `limit` back to a number via `z.coerce`. Skipping undefineds keeps
  // the URL clean when the caller doesn't narrow a dimension.
  const query: Record<string, string> = {}
  if (params.window) query.window = params.window
  if (params.sort) query.sort = params.sort
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor

  const res = await api.api.clips.$get({ query })
  return readJson<ClipRow[]>(res)
}

export async function initiateClip(
  input: InitiateClipInput
): Promise<InitiateClipResponse> {
  const res = await api.api.clips.initiate.$post({ json: input })
  return readJson<InitiateClipResponse>(res)
}

export async function finalizeClip(clipId: string): Promise<ClipRow> {
  const res = await api.api.clips[":id"].finalize.$post({
    param: { id: clipId },
  })
  return readJson<ClipRow>(res)
}

export async function deleteClip(clipId: string): Promise<void> {
  const res = await api.api.clips[":id"].$delete({ param: { id: clipId } })
  await readJson<{ deleted: true }>(res)
}

export async function fetchUploadQueue(): Promise<QueueClip[]> {
  const res = await api.api.clips.queue.$get()
  return readJson<QueueClip[]>(res)
}

/**
 * Push the file bytes at the upload ticket. We use XHR rather than
 * `fetch()` because `fetch` still has no upload-progress event in any
 * shipped browser; XHR's `upload.onprogress` is the only way to drive
 * the percentage on the queue row.
 *
 * `signal` lets the caller cancel mid-upload (the cancel button on the
 * queue row aborts the XHR via this signal).
 */
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
          const body = JSON.parse(xhr.responseText) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // Non-JSON body — keep the status line.
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

// ─── URL builders ──────────────────────────────────────────────────────

/**
 * Direct media URLs for `<video>` / `<img>`. The Hono RPC client doesn't
 * help here — the player needs a plain URL it can hand to the browser's
 * own range-fetcher. Cookies travel because we set the API base on the
 * same origin policy and the browser sends credentials for media when
 * the element opts in (`crossOrigin="use-credentials"`).
 */
export function clipStreamUrl(clipId: string): string {
  return `${env.VITE_API_URL}/api/clips/${clipId}/stream`
}

export function clipThumbnailUrl(
  clipId: string,
  size: "small" | "full" = "full"
): string {
  return `${env.VITE_API_URL}/api/clips/${clipId}/thumbnail?size=${size}`
}
