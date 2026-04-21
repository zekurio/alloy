import { api } from "./api"
import { apiOrigin } from "./env"
import { readJsonOrThrow } from "./http-error"

export type ClipStatus =
  | "pending"
  | "uploaded"
  | "encoding"
  | "ready"
  | "failed"
export type ClipPrivacy = "public" | "unlisted" | "private"

export interface UploadTicket {
  uploadUrl: string
  method: "PUT" | "POST"
  headers: Record<string, string>
  expiresAt: number
}

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
  gameId: string
  privacy?: ClipPrivacy
  trimStartMs?: number
  trimEndMs?: number
  thumbSizeBytes: number
  mentionedUserIds?: string[]
}

export interface ClipMentionRef {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
}

export interface InitiateClipResponse {
  clipId: string
  slug: string
  ticket: UploadTicket
  thumbTicket: UploadTicket
}

export interface ClipGameRef {
  id: string
  steamgriddbId: number
  slug: string
  name: string
  releaseDate: string | null
  heroUrl: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export interface ClipEncodedVariant {
  id: string
  label: string
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
}

export interface ClipRow {
  id: string
  slug: string
  authorId: string
  title: string
  description: string | null
  game: string | null
  gameId: string | null
  /** Mapped game metadata joined from `game`. Prefer this for labels + links. */
  gameRef: ClipGameRef | null
  privacy: ClipPrivacy
  storageKey: string
  contentType: string
  sizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  variants: ClipEncodedVariant[]
  thumbKey: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  status: ClipStatus
  encodeProgress: number
  failureReason: string | null
  createdAt: string
  updatedAt: string
  authorUsername: string
  authorName: string
  authorImage: string | null
  /** Only populated by the clip-detail endpoint; list shapes omit this. */
  mentions?: ClipMentionRef[]
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

export interface QueueClip {
  id: string
  gameSlug: string
  title: string
  status: ClipStatus
  encodeProgress: number
  failureReason: string | null
  createdAt: string
}

export async function fetchClips(
  params: ClipFeedParams = {}
): Promise<ClipRow[]> {
  const query: Record<string, string> = {}
  if (params.window) query.window = params.window
  if (params.sort) query.sort = params.sort
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor

  const res = await api.api.clips.$get({ query })
  return readJsonOrThrow<ClipRow[]>(res)
}

export async function fetchClipById(clipId: string): Promise<ClipRow> {
  const res = await api.api.clips[":id"].$get({ param: { id: clipId } })
  return readJsonOrThrow<ClipRow>(res)
}

export async function initiateClip(
  input: InitiateClipInput
): Promise<InitiateClipResponse> {
  const res = await api.api.clips.initiate.$post({ json: input })
  return readJsonOrThrow<InitiateClipResponse>(res)
}

export async function finalizeClip(clipId: string): Promise<ClipRow> {
  const res = await api.api.clips[":id"].finalize.$post({
    param: { id: clipId },
  })
  return readJsonOrThrow<ClipRow>(res)
}

export async function deleteClip(clipId: string): Promise<void> {
  const res = await api.api.clips[":id"].$delete({ param: { id: clipId } })
  await readJsonOrThrow<{ deleted: true }>(res)
}

export interface UpdateClipInput {
  title?: string
  description?: string
  gameId?: string
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
}

export async function updateClip(
  clipId: string,
  input: UpdateClipInput
): Promise<ClipRow> {
  const res = await api.api.clips[":id"].$patch({
    param: { id: clipId },
    json: input,
  })
  return readJsonOrThrow<ClipRow>(res)
}

export async function fetchUploadQueue(): Promise<QueueClip[]> {
  const res = await api.api.clips.queue.$get()
  return readJsonOrThrow<QueueClip[]>(res)
}

export interface ClipLikeState {
  liked: boolean
  likeCount: number
}

export async function fetchLikeState(
  clipId: string
): Promise<{ liked: boolean }> {
  const res = await api.api.clips[":id"].like.$get({ param: { id: clipId } })
  return readJsonOrThrow<{ liked: boolean }>(res)
}

export async function likeClip(clipId: string): Promise<ClipLikeState> {
  const res = await api.api.clips[":id"].like.$post({
    param: { id: clipId },
  })
  return readJsonOrThrow<ClipLikeState>(res)
}

export async function unlikeClip(clipId: string): Promise<ClipLikeState> {
  const res = await api.api.clips[":id"].like.$delete({
    param: { id: clipId },
  })
  return readJsonOrThrow<ClipLikeState>(res)
}

export async function recordView(clipId: string): Promise<void> {
  try {
    await api.api.clips[":id"].view.$post({ param: { id: clipId } })
  } catch {
    // View tracking is best-effort — never surface.
  }
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

export function clipStreamUrl(clipId: string, variantId?: string): string {
  const url = new URL(`${apiOrigin()}/api/clips/${clipId}/stream`)
  if (variantId) url.searchParams.set("variant", variantId)
  return url.toString()
}

export function clipThumbnailUrl(clipId: string): string {
  return `${apiOrigin()}/api/clips/${clipId}/thumbnail`
}

export function clipDownloadUrl(clipId: string, variantId: string): string {
  const url = new URL(`${apiOrigin()}/api/clips/${clipId}/download`)
  url.searchParams.set("variant", variantId)
  return url.toString()
}
