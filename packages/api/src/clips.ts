import {
  CLIP_THUMBNAIL_WIDTHS,
  type ClipRow,
  type ClipThumbnailWidth,
  type InitiateClipInput,
  type InitiateClipResponse,
  type QueueClip,
  type QueueEvent,
  type SetClipPosterInput,
  type TrimClipInput,
  type UpdateClipInput,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateClipRow,
  validateInitiateClipResponse,
  validateQueueClips,
  validateQueueEvent,
} from "./contract-validators"
import { parseJsonPayload, readJsonOrThrow, readNoContentOrThrow } from "./http"
import { readDeletedJson, readSuccessJson } from "./mutations"
import { encodedPathSegment, resolvePublicUrlWithQuery } from "./paths"

export {
  ACCEPTED_CLIP_CONTENT_TYPES,
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_THUMBNAIL_WIDTHS,
  CLIP_TITLE_MAX_LENGTH,
} from "@alloy/contracts"
export { uploadToTicket } from "./clip-upload"
export type {
  AcceptedContentType,
  ClipFeedSort,
  ClipGameRef,
  ClipListSort,
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

function versionedClipAssetUrl(
  clipId: string,
  suffix: string,
  origin?: string,
  version?: string,
): string {
  // An undefined version is dropped from the query, so unversioned asset URLs
  // share this helper too.
  return resolvePublicUrlWithQuery(
    `/api/clips/${encodedPathSegment(clipId)}${suffix}`,
    { v: version },
    origin,
  )
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
  return versionedClipAssetUrl(
    clipId,
    `/rendition/${encodeURIComponent(name)}/file.mp4`,
    origin,
    version,
  )
}

export function clipSourceFileUrl(
  clipId: string,
  origin?: string,
  version?: string,
): string {
  return versionedClipAssetUrl(clipId, "/source/file", origin, version)
}

export function clipOriginalFileUrl(clipId: string, origin?: string): string {
  return versionedClipAssetUrl(clipId, "/original/file", origin)
}

export function clipWaveformFileUrl(
  clipId: string,
  origin?: string,
  version?: string,
): string {
  return versionedClipAssetUrl(clipId, "/waveform/file.m4a", origin, version)
}

/** The clip's JPEG poster, or its WebP copy `width` px wide. */
export function clipThumbnailUrl(
  clipId: string,
  origin?: string,
  version?: string,
  width?: ClipThumbnailWidth,
): string {
  return resolvePublicUrlWithQuery(
    `/api/clips/${encodedPathSegment(clipId)}/thumbnail`,
    { v: version, w: width },
    origin,
  )
}

/** `srcset` over every resized thumbnail, for a responsive `<img>`. */
export function clipThumbnailSrcSet(
  clipId: string,
  origin?: string,
  version?: string,
): string {
  return CLIP_THUMBNAIL_WIDTHS.map(
    (width) => `${clipThumbnailUrl(clipId, origin, version, width)} ${width}w`,
  ).join(", ")
}

export function clipDownloadUrl(clipId: string, origin?: string): string {
  return versionedClipAssetUrl(clipId, "/download", origin)
}

export function createClipsApi(context: ApiContext) {
  const clips = context.rpc.api.clips

  return {
    async fetchById(clipId: string): Promise<ClipRow> {
      const res = await clips[":id"].$get({ param: { id: clipId } })
      return readJsonOrThrow(res, validateClipRow)
    },
    async initiate(input: InitiateClipInput): Promise<InitiateClipResponse> {
      const res = await clips.initiate.$post({ json: input })
      return readJsonOrThrow(res, validateInitiateClipResponse)
    },
    async finalize(clipId: string): Promise<ClipRow> {
      const res = await clips[":id"].finalize.$post({ param: { id: clipId } })
      return readJsonOrThrow(res, validateClipRow)
    },
    async markUploadFailed(clipId: string): Promise<void> {
      const res = await clips[":id"].fail.$post({ param: { id: clipId } })
      await readSuccessJson(res)
    },
    async delete(clipId: string): Promise<void> {
      const res = await clips[":id"].$delete({ param: { id: clipId } })
      await readDeletedJson(res)
    },
    async dismissQueue(clipId: string): Promise<void> {
      const res = await clips[":id"]["queue-dismissal"].$post({
        param: { id: clipId },
      })
      await readSuccessJson(res)
    },
    async update(clipId: string, input: UpdateClipInput): Promise<ClipRow> {
      const res = await clips[":id"].$patch({
        param: { id: clipId },
        json: input,
      })
      return readJsonOrThrow(res, validateClipRow)
    },
    async trim(clipId: string, input: TrimClipInput): Promise<ClipRow> {
      const res = await clips[":id"].trim.$post({
        param: { id: clipId },
        json: input,
      })
      return readJsonOrThrow(res, validateClipRow)
    },
    async updateImage(clipId: string, file: File, sourceVersion: string) {
      const body = new FormData()
      body.set("file", file)
      body.set("sourceVersion", sourceVersion)
      const response = await context.request(
        `/api/clips/${encodedPathSegment(clipId)}/image`,
        { method: "POST", init: { body } },
      )
      return readJsonOrThrow(response, validateClipRow)
    },
    async reEncode(clipId: string): Promise<ClipRow> {
      const res = await clips[":id"]["re-encode"].$post({
        param: { id: clipId },
      })
      return readJsonOrThrow(res, validateClipRow)
    },
    async reannounce(clipId: string): Promise<void> {
      const res = await clips[":id"].reannounce.$post({
        param: { id: clipId },
      })
      await readNoContentOrThrow(res)
    },
    async setPoster(
      clipId: string,
      input: SetClipPosterInput,
    ): Promise<ClipRow> {
      const res = await clips[":id"].poster.$post({
        param: { id: clipId },
        json: input,
      })
      return readJsonOrThrow(res, validateClipRow)
    },
    async recordView(clipId: string): Promise<void> {
      const res = await clips[":id"].view.$post({ param: { id: clipId } })
      await readNoContentOrThrow(res)
    },
  }
}
