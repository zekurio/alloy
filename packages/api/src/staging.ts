import type {
  InitiateStagingInput,
  InitiateStagingResponse,
  PublishStagingInput,
  PublishStagingResponse,
  RecordingKind,
  StagingRecordingPage,
  StagingRecordingRow,
  TrimClipInput,
  UpdateStagingInput,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateInitiateStagingResponse,
  validatePublishStagingResponse,
  validateStagingPage,
  validateStagingRow,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readDeletedJson, readSuccessJson } from "./mutations"
import {
  encodedPathSegment,
  queryParams,
  resolvePublicUrlWithQuery,
} from "./paths"

export type {
  InitiateStagingInput,
  InitiateStagingResponse,
  PublishStagingInput,
  PublishStagingResponse,
  RecordingKind,
  StagingRecordingPage,
  StagingRecordingRow,
  UpdateStagingInput,
} from "@alloy/contracts"

export interface StagingListParams {
  kind?: RecordingKind
  limit?: number
  cursor?: string | null
}

function publicStagingPath(id: string, suffix: string): string {
  return `/api/staging/${encodedPathSegment(id)}${suffix}`
}

export function stagingStreamUrl(
  id: string,
  variantId?: string,
  origin?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicStagingPath(id, "/stream"),
    { variant: variantId },
    origin,
  )
}

export function stagingThumbnailUrl(
  id: string,
  origin?: string,
  version?: string,
): string {
  return resolvePublicUrlWithQuery(
    publicStagingPath(id, "/thumbnail"),
    { v: version },
    origin,
  )
}

async function fetchStagingPage(
  context: ApiContext,
  params: StagingListParams = {},
): Promise<StagingRecordingPage> {
  const res = await context.rpc.api.staging.$get({
    query: queryParams({
      kind: params.kind,
      limit: params.limit,
      cursor: params.cursor,
    }),
  })
  return readJsonOrThrow(res, validateStagingPage)
}

async function fetchStagingById(
  context: ApiContext,
  id: string,
  init?: RequestInit,
): Promise<StagingRecordingRow> {
  const res = await context.rpc.api.staging[":id"].$get(
    { param: { id } },
    { init },
  )
  return readJsonOrThrow(res, validateStagingRow)
}

async function initiateStaging(
  context: ApiContext,
  input: InitiateStagingInput,
): Promise<InitiateStagingResponse> {
  const res = await context.rpc.api.staging.initiate.$post({ json: input })
  return readJsonOrThrow(res, validateInitiateStagingResponse)
}

async function finalizeStaging(
  context: ApiContext,
  id: string,
): Promise<StagingRecordingRow> {
  const res = await context.rpc.api.staging[":id"].finalize.$post({
    param: { id },
  })
  return readJsonOrThrow(res, validateStagingRow)
}

async function markStagingUploadFailed(
  context: ApiContext,
  id: string,
): Promise<void> {
  const res = await context.rpc.api.staging[":id"].fail.$post({ param: { id } })
  await readSuccessJson(res)
}

async function updateStaging(
  context: ApiContext,
  id: string,
  input: UpdateStagingInput,
): Promise<StagingRecordingRow> {
  const res = await context.rpc.api.staging[":id"].$patch({
    param: { id },
    json: input,
  })
  return readJsonOrThrow(res, validateStagingRow)
}

async function trimStaging(
  context: ApiContext,
  id: string,
  input: TrimClipInput,
): Promise<StagingRecordingRow> {
  const res = await context.rpc.api.staging[":id"].trim.$post({
    param: { id },
    json: input,
  })
  return readJsonOrThrow(res, validateStagingRow)
}

async function publishStaging(
  context: ApiContext,
  id: string,
  input: PublishStagingInput,
): Promise<PublishStagingResponse> {
  const res = await context.rpc.api.staging[":id"].publish.$post({
    param: { id },
    json: input,
  })
  return readJsonOrThrow(res, validatePublishStagingResponse)
}

async function deleteStaging(context: ApiContext, id: string): Promise<void> {
  const res = await context.rpc.api.staging[":id"].$delete({ param: { id } })
  await readDeletedJson(res)
}

export function createStagingApi(context: ApiContext) {
  return {
    fetchPage: (params: StagingListParams = {}) =>
      fetchStagingPage(context, params),
    fetch: async (params: StagingListParams = {}) =>
      (await fetchStagingPage(context, params)).items,
    fetchById: (id: string, init?: RequestInit) =>
      fetchStagingById(context, id, init),
    initiate: (input: InitiateStagingInput) => initiateStaging(context, input),
    finalize: (id: string) => finalizeStaging(context, id),
    markUploadFailed: (id: string) => markStagingUploadFailed(context, id),
    update: (id: string, input: UpdateStagingInput) =>
      updateStaging(context, id, input),
    trim: (id: string, input: TrimClipInput) => trimStaging(context, id, input),
    publish: (id: string, input: PublishStagingInput) =>
      publishStaging(context, id, input),
    delete: (id: string) => deleteStaging(context, id),
  }
}
