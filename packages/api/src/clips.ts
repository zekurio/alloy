import type {
  ClipLikeState,
  ClipRow,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  SetClipPosterInput,
  TrimClipInput,
  UpdateClipInput,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateClipLikeState,
  validateClipRow,
  validateInitiateClipResponse,
  validateQueueClips,
  validateQueueEvent,
} from "./contract-validators"
import { parseJsonPayload, readJsonOrThrow, readNoContentOrThrow } from "./http"
import {
  readBooleanFlagJson,
  readDeletedJson,
  readPostDeleteJson,
  readSuccessJson,
} from "./mutations"
import { encodedPathSegment, resolvePublicUrlWithQuery } from "./paths"

export {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
export { uploadToTicket } from "./clip-upload"
export type {
  AcceptedContentType,
  ClipFeedSort,
  ClipGameRef,
  ClipListSort,
  ClipLikeState,
  ClipMentionRef,
  ClipPage,
  ClipPrivacy,
  ClipRenditionRef,
  ClipRow,
  ClipStatus,
  EncodeStage,
  InitiateClipInput,
  InitiateClipResponse,
  QueueClip,
  QueueEvent,
  SetClipPosterInput,
  TrimClipInput,
  UpdateClipInput,
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

export function clipRenditionFileUrl(
  clipId: string,
  name: string,
  origin?: string,
  version?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, `/rendition/${encodeURIComponent(name)}/file.mp4`),
    { v: version },
    origin,
  )
}

export function clipSourceFileUrl(
  clipId: string,
  origin?: string,
  version?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/source/file"),
    { v: version },
    origin,
  )
}

export function clipOriginalFileUrl(clipId: string, origin?: string): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/original/file"),
    {},
    origin,
  )
}

export function clipScrubberFileUrl(clipId: string, origin?: string): string {
  return resolvePublicUrlWithQuery(
    publicClipPath(clipId, "/scrubber/file"),
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

async function reEncodeClip(
  context: ApiContext,
  clipId: string,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"]["re-encode"].$post({
    param: { id: clipId },
  })
  return readJsonOrThrow(res, validateClipRow)
}

async function setClipPoster(
  context: ApiContext,
  clipId: string,
  input: SetClipPosterInput,
): Promise<ClipRow> {
  const res = await context.rpc.api.clips[":id"].poster.$post({
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
    reEncode: (clipId: string) => reEncodeClip(context, clipId),
    setPoster: (clipId: string, input: SetClipPosterInput) =>
      setClipPoster(context, clipId, input),
    fetchLikeState: (clipId: string) => fetchLikeState(context, clipId),
    like: (clipId: string) => setClipLike(context, clipId, true),
    unlike: (clipId: string) => setClipLike(context, clipId, false),
    recordView: (clipId: string) => recordClipView(context, clipId),
  }
}
