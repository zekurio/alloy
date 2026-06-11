import type {
  ClipFeedParams,
  ClipLikeState,
  ClipPage,
  ClipRow,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  TrimClipInput,
  UpdateClipInput,
  UploadTicket,
} from "alloy-contracts"

import type { ApiContext } from "./client"
import {
  validateClipLikeState,
  validateClipPage,
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
import {
  encodedPathSegment,
  queryParams,
  resolvePublicUrlWithQuery,
} from "./paths"

const UPLOAD_TIMEOUT_GRACE_MS = 30_000
const MIN_UPLOAD_TIMEOUT_MS = 30_000

export {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TITLE_MAX_LENGTH,
} from "alloy-contracts"
export type {
  AcceptedContentType,
  ClipFeedParams,
  ClipFeedSort,
  ClipFeedWindow,
  ClipGameRef,
  ClipLikeState,
  ClipMentionRef,
  ClipPage,
  ClipPlaybackQuality,
  ClipPrivacy,
  ClipRow,
  ClipStatus,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  TrimClipInput,
  UpdateClipInput,
  UploadTicket,
} from "alloy-contracts"

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
  liveCodecs?: readonly string[],
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/stream"),
    { variant: variantId, codecs: liveCodecsParam(liveCodecs) },
    origin,
  )
}

export function clipHlsMasterUrl(
  clipId: string,
  origin?: string,
  liveCodecs?: readonly string[],
  variantId?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/hls/master.m3u8"),
    { variant: variantId, codecs: liveCodecsParam(liveCodecs) },
    origin,
  )
}

function liveCodecsParam(liveCodecs?: readonly string[]): string | undefined {
  if (!liveCodecs) return undefined
  return liveCodecs.length > 0 ? liveCodecs.join(",") : "none"
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

export function clipDownloadUrl(
  clipId: string,
  variantId: string,
  origin?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/download"),
    { variant: variantId },
    origin,
  )
}

export function uploadToTicket(
  ticket: UploadTicket,
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
        ticket.expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS,
      )
      xhr.send(body)
    } catch (err) {
      settle(() => reject(toError(err, "Could not start upload")))
    }
  })
}

async function fetchClipPage(
  context: ApiContext,
  params: ClipFeedParams = {},
): Promise<ClipPage> {
  const res = await context.rpc.api.clips.$get({
    query: queryParams({
      window: params.window,
      sort: params.sort,
      limit: params.limit,
      cursor: params.cursor,
    }),
  })
  return readJsonOrThrow(res, validateClipPage)
}

async function fetchClips(
  context: ApiContext,
  params: ClipFeedParams = {},
): Promise<ClipRow[]> {
  return (await fetchClipPage(context, params)).items
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
    fetch: (params: ClipFeedParams = {}) => fetchClips(context, params),
    fetchPage: (params: ClipFeedParams = {}) => fetchClipPage(context, params),
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
