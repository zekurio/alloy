import type {
  AdminFailedJobsPage,
  AdminJobsSummary,
  AdminSweepKind,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateAdminFailedJobsPage,
  validateAdminJobsSummary,
  validateAdminReEncodeResponse,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readSuccessJson } from "./mutations"

export async function reEncodeAllClips(
  context: ApiContext,
): Promise<{ enqueued: number; hasMore: boolean }> {
  const res = await context.rpc.api.admin.clips["re-encode"].$post()
  return readJsonOrThrow(res, validateAdminReEncodeResponse)
}

export async function fetchJobsSummary(
  context: ApiContext,
): Promise<AdminJobsSummary> {
  const res = await context.rpc.api.admin.jobs.summary.$get()
  return readJsonOrThrow(res, validateAdminJobsSummary)
}

export async function fetchFailedJobs(
  context: ApiContext,
  options: { kind?: string; cursor?: string; limit?: number } = {},
): Promise<AdminFailedJobsPage> {
  const res = await context.rpc.api.admin.jobs.failed.$get({
    query: {
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit ? { limit: String(options.limit) } : {}),
    },
  })
  return readJsonOrThrow(res, validateAdminFailedJobsPage)
}

export async function retryJob(
  context: ApiContext,
  jobId: string,
): Promise<void> {
  const res = await context.rpc.api.admin.jobs[":id"].retry.$post({
    param: { id: jobId },
  })
  await readSuccessJson(res)
}

export async function discardJob(
  context: ApiContext,
  jobId: string,
): Promise<void> {
  const res = await context.rpc.api.admin.jobs[":id"].discard.$post({
    param: { id: jobId },
  })
  await readSuccessJson(res)
}

export async function runJobSweep(
  context: ApiContext,
  kind: AdminSweepKind,
  mode: "stale" | "force" = "stale",
): Promise<void> {
  const res = await context.rpc.api.admin.jobs.sweeps[":kind"].$post({
    param: { kind },
    json: { mode },
  })
  await readSuccessJson(res)
}

export async function setJobKindPaused(
  context: ApiContext,
  kind: string,
  paused: boolean,
): Promise<void> {
  const res = paused
    ? await context.rpc.api.admin.jobs.kinds[":kind"].pause.$post({
        param: { kind },
      })
    : await context.rpc.api.admin.jobs.kinds[":kind"].resume.$post({
        param: { kind },
      })
  await readSuccessJson(res)
}
