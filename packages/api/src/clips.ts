import type {
  ClipLikeState,
  ClipRow,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  TrimClipInput,
  UpdateClipInput,
  UploadPartTicket,
  UploadTicket,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateClipLikeState,
  validateClipRow,
  validateInitiateClipResponse,
  validateQueueClips,
  validateQueueEvent,
} from "./contract-validators"
import { toError } from "./error"
import {
  parseErrorMessagePayload,
  parseJsonPayload,
  readJsonOrThrow,
  readNoContentOrThrow,
} from "./http"
import {
  readBooleanFlagJson,
  readDeletedJson,
  readPostDeleteJson,
  readSuccessJson,
} from "./mutations"
import { encodedPathSegment, resolvePublicUrlWithQuery } from "./paths"

const UPLOAD_TIMEOUT_GRACE_MS = 30_000
const MIN_UPLOAD_TIMEOUT_MS = 30_000

export {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
export type {
  AcceptedContentType,
  ClipFeedSort,
  ClipGameRef,
  ClipListSort,
  ClipLikeState,
  ClipMentionRef,
  ClipPage,
  ClipPrivacy,
  ClipRow,
  ClipStatus,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  TrimClipInput,
  UpdateClipInput,
  UploadPartTicket,
  UploadTicket,
} from "@alloy/contracts"

function publicClipPath(clipId: string, suffix: string): string {
  return `/api/clips/${encodedPathSegment(clipId)}${suffix}`
}

export function parseQueueSnapshotPayload(data: string): QueueClip[] | null {
  return parseJsonPayload(data, validateQueueClips)
}

export function parseQueueEventPayload(data: string): QueueEvent | null {
  return parseJsonPayload(data, validateQueueEvent)
}

export function uploadQueueStreamUrl(origin?: string): string {
  return resolvePublicUrlWithQuery("/api/events/clips/queue", {}, origin)
}

export function clipStreamUrl(
  clipId: string,
  variantId?: string,
  origin?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/stream"),
    { variant: variantId },
    origin,
  )
}

export function clipHlsMasterUrl(clipId: string, origin?: string): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/hls/master.m3u8"),
    {},
    origin,
  )
}

export function clipThumbnailUrl(
  clipId: string,
  origin?: string,
  version?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/thumbnail"),
    { v: version },
    origin,
  )
}

export function clipDownloadUrl(clipId: string, origin?: string): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/download"),
    {},
    origin,
  )
}

export function uploadToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (ticket.strategy?.type === "chunked") {
    return uploadChunkedToTicket(ticket, body, onProgress, signal)
  }
  if (ticket.strategy?.type === "multipart") {
    return uploadMultipartToTicket(ticket, body, onProgress, signal)
  }
  return uploadSingleToTicket(ticket, body, onProgress, signal)
}

function uploadSingleToTicket(
  ticket: UploadTicket | UploadPartTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
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
        (name) => name.toLowerCase() === "content-type",
      )
      if (!hasContentType && body.type) {
        xhr.setRequestHeader("Content-Type", body.type)
      }
    } catch (err) {
      settle(() => reject(toError(err, "Could not prepare upload request")))
      return
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(resolve)
      } else {
        const message =
          parseErrorMessagePayload(xhr.responseText) ??
          `${xhr.status} ${xhr.statusText}`
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
        "expiresAt" in ticket
          ? ticket.expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS
          : MIN_UPLOAD_TIMEOUT_MS,
      )
      xhr.send(body)
    } catch (err) {
      settle(() => reject(toError(err, "Could not start upload")))
    }
  })
}

async function uploadChunkedToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const strategy = ticket.strategy
  if (strategy?.type !== "chunked") {
    throw new Error("Upload ticket is not chunked")
  }
  const chunkSize = strategy.chunkSizeBytes
  const partCount = Math.ceil(body.size / chunkSize)
  try {
    for (let index = 0; index < partCount; index += 1) {
      throwIfAborted(signal)
      const start = index * chunkSize
      const end = Math.min(start + chunkSize, body.size)
      await uploadSingleToTicket(
        {
          uploadUrl: `${ticket.uploadUrl}/chunks/${index + 1}`,
          method: "PUT",
          headers: {},
          expiresAt: ticket.expiresAt,
        },
        body.slice(start, end),
        (loaded) => onProgress(start + loaded, body.size),
        signal,
      )
    }
    throwIfAborted(signal)
    await postTicketControl(ticket.uploadUrl, "complete", undefined, signal)
    onProgress(body.size, body.size)
  } catch (err) {
    await abortTicketUpload(ticket.uploadUrl)
    throw err
  }
}

async function uploadMultipartToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const strategy = ticket.strategy
  if (strategy?.type !== "multipart") {
    throw new Error("Upload ticket is not multipart")
  }
  const partSize = strategy.partSizeBytes
  const partCount = Math.ceil(body.size / partSize)
  const loadedByPart = new Map<number, number>()
  const completedParts: Array<{ partNumber: number; etag: string }> = []

  try {
    for (let index = 0; index < partCount; index += 1) {
      throwIfAborted(signal)
      const partNumber = index + 1
      const start = index * partSize
      const end = Math.min(start + partSize, body.size)
      const partTicket = await signMultipartPart(
        ticket.uploadUrl,
        partNumber,
        signal,
      )
      const etag = await uploadMultipartPart(
        partTicket,
        body.slice(start, end),
        partNumber,
        loadedByPart,
        body.size,
        onProgress,
        Math.max(
          MIN_UPLOAD_TIMEOUT_MS,
          ticket.expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS,
        ),
        signal,
      )
      completedParts.push({ partNumber, etag })
      loadedByPart.set(partNumber, end - start)
      reportPartProgress(loadedByPart, body.size, onProgress)
    }
    throwIfAborted(signal)
    await postTicketControl(
      ticket.uploadUrl,
      "complete",
      { parts: completedParts },
      signal,
    )
    onProgress(body.size, body.size)
  } catch (err) {
    await abortTicketUpload(ticket.uploadUrl)
    throw err
  }
}

async function signMultipartPart(
  uploadUrl: string,
  partNumber: number,
  signal?: AbortSignal,
): Promise<UploadPartTicket> {
  const res = await fetch(`${uploadUrl}/parts/${partNumber}`, {
    method: "POST",
    signal,
  })
  if (!res.ok) throw new Error(await responseErrorMessage(res))
  const data = (await res.json()) as Partial<UploadPartTicket>
  if (
    typeof data.uploadUrl !== "string" ||
    data.method !== "PUT" ||
    !data.headers ||
    typeof data.headers !== "object"
  ) {
    throw new Error("Invalid multipart upload part ticket")
  }
  return {
    uploadUrl: data.uploadUrl,
    method: data.method,
    headers: stringRecord(data.headers),
  }
}

function uploadMultipartPart(
  ticket: UploadPartTicket,
  body: Blob,
  partNumber: number,
  loadedByPart: Map<number, number>,
  totalBytes: number,
  onProgress: (loaded: number, total: number) => void,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
    } catch (err) {
      settle(() => reject(toError(err, "Could not prepare upload request")))
      return
    }

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      loadedByPart.set(partNumber, e.loaded)
      reportPartProgress(loadedByPart, totalBytes, onProgress)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag")
        if (!etag) {
          settle(() =>
            reject(new Error("Storage did not expose the uploaded part ETag")),
          )
          return
        }
        settle(() => resolve(etag))
      } else {
        const message =
          parseErrorMessagePayload(xhr.responseText) ??
          `${xhr.status} ${xhr.statusText}`
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
      xhr.timeout = timeoutMs
      xhr.send(body)
    } catch (err) {
      settle(() => reject(toError(err, "Could not start upload")))
    }
  })
}

function reportPartProgress(
  loadedByPart: Map<number, number>,
  totalBytes: number,
  onProgress: (loaded: number, total: number) => void,
): void {
  let loaded = 0
  for (const value of loadedByPart.values()) loaded += value
  onProgress(Math.min(loaded, totalBytes), totalBytes)
}

async function postTicketControl(
  uploadUrl: string,
  suffix: string,
  json: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${uploadUrl}/${suffix}`, {
    method: "POST",
    headers:
      json === undefined ? undefined : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
    signal,
  })
  if (!res.ok) throw new Error(await responseErrorMessage(res))
}

async function abortTicketUpload(uploadUrl: string): Promise<void> {
  try {
    await fetch(uploadUrl, { method: "DELETE" })
  } catch {
    // Best effort: the server reaper also cleans expired tickets.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError")
}

async function responseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return parseErrorMessagePayload(text) ?? `${res.status} ${res.statusText}`
}

function stringRecord(value: object): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error("Invalid multipart upload part ticket")
    }
    out[key] = item
  }
  return out
}

async function fetchClipById(
  context: ApiContext,
  clipId: string,
  init?: RequestInit,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"].$get(
    { param: { id: clipId } },
    { init },
  )
  return readJsonOrThrow(res, validateClipRow)
}

async function initiateClip(
  context: ApiContext,
  input: InitiateClipInput,
): Promise<InitiateClipResponse> {
  const res = await context.rpc.api.clips.initiate.$post({ json: input })
  return readJsonOrThrow(res, validateInitiateClipResponse)
}

async function finalizeClip(
  context: ApiContext,
  clipId: string,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"].finalize.$post({
    param: { id: clipId },
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function markUploadFailed(
  context: ApiContext,
  clipId: string,
): Promise<void> {
  const res = await context.rpc.api.clips[":id"].fail.$post({
    param: { id: clipId },
  })
  await readSuccessJson(res)
}

async function deleteClip(context: ApiContext, clipId: string): Promise<void> {
  const res = await context.rpc.api.clips[":id"].$delete({
    param: { id: clipId },
  })
  await readDeletedJson(res)
}

async function updateClip(
  context: ApiContext,
  clipId: string,
  input: UpdateClipInput,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"].$patch({
    param: { id: clipId },
    json: input,
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function trimClip(
  context: ApiContext,
  clipId: string,
  input: TrimClipInput,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"].trim.$post({
    param: { id: clipId },
    json: input,
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function fetchLikeState(
  context: ApiContext,
  clipId: string,
): Promise<{ liked: boolean }> {
  const res = await context.rpc.api.clips[":id"].like.$get({
    param: { id: clipId },
  })
  return readBooleanFlagJson(res, "liked")
}

async function setClipLike(
  context: ApiContext,
  clipId: string,
  liked: boolean,
): Promise<ClipLikeState> {
  return readPostDeleteJson(
    liked,
    {
      post: () =>
        context.rpc.api.clips[":id"].like.$post({
          param: { id: clipId },
        }),
      delete: () =>
        context.rpc.api.clips[":id"].like.$delete({
          param: { id: clipId },
        }),
    },
    validateClipLikeState,
  )
}

async function recordClipView(
  context: ApiContext,
  clipId: string,
): Promise<void> {
  const res = await context.rpc.api.clips[":id"].view.$post({
    param: { id: clipId },
  })
  await readNoContentOrThrow(res)
}

export function createClipsApi(context: ApiContext) {
  return {
    fetchById: (clipId: string, init?: RequestInit) =>
      fetchClipById(context, clipId, init),
    initiate: (input: InitiateClipInput) => initiateClip(context, input),
    finalize: (clipId: string) => finalizeClip(context, clipId),
    markUploadFailed: (clipId: string) => markUploadFailed(context, clipId),
    delete: (clipId: string) => deleteClip(context, clipId),
    update: (clipId: string, input: UpdateClipInput) =>
      updateClip(context, clipId, input),
    trim: (clipId: string, input: TrimClipInput) =>
      trimClip(context, clipId, input),
    fetchLikeState: (clipId: string) => fetchLikeState(context, clipId),
    like: (clipId: string) => setClipLike(context, clipId, true),
    unlike: (clipId: string) => setClipLike(context, clipId, false),
    recordView: (clipId: string) => recordClipView(context, clipId),
  }
}
