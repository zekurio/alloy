import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { errorMessage } from "./error-message"

function errorResponse(
  c: Context,
  error: string,
  status: ContentfulStatusCode,
) {
  return c.json({ error }, status)
}

export function errorResult(
  c: Context,
  result: { error: string; status: ContentfulStatusCode },
) {
  return errorResponse(c, result.error, result.status)
}

export function booleanFlag<T extends string>(
  c: Context,
  key: T,
  value: boolean,
) {
  return c.json({ [key]: value } as Record<T, boolean>)
}

export function batchProgress<T extends string>(
  c: Context,
  countKey: T,
  count: number,
  hasMore: boolean,
) {
  return c.json({ [countKey]: count, hasMore } as Record<T, number> & {
    hasMore: boolean
  })
}

export function likeState(c: Context, liked: boolean, likeCount: number) {
  return c.json({ liked, likeCount })
}

export function accountState(c: Context, disabledAt: string | null) {
  return c.json({ disabledAt })
}

export function urlResponse(c: Context, url: string) {
  return c.json({ url })
}

export function steamGridDBStatus(c: Context, configured: boolean) {
  return c.json({ steamgriddbConfigured: configured })
}

export function success(c: Context) {
  return booleanFlag(c, "success", true)
}

export function deleted(c: Context) {
  return booleanFlag(c, "deleted", true)
}

export function noContent(c: Context) {
  return c.body(null, 204)
}

export function unauthorized(c: Context, error = "Unauthorized") {
  return errorResponse(c, error, 401)
}

export function forbidden(c: Context, error = "Forbidden") {
  return errorResponse(c, error, 403)
}

export function notFound(c: Context, error = "Not found") {
  return errorResponse(c, error, 404)
}

export function badRequest(c: Context, error: string) {
  return errorResponse(c, error, 400)
}

export function conflict(c: Context, error: string) {
  return errorResponse(c, error, 409)
}

export function gone(c: Context, error: string) {
  return errorResponse(c, error, 410)
}

export function payloadTooLarge(c: Context, error: string) {
  return errorResponse(c, error, 413)
}

export function badGateway(c: Context, error: string) {
  return errorResponse(c, error, 502)
}

export function serviceUnavailable(c: Context, error: string) {
  return errorResponse(c, error, 503)
}

export function badRequestFromCause(
  c: Context,
  cause: unknown,
  fallback: string,
) {
  return badRequest(c, errorMessage(cause, fallback))
}

export function invalidCursor(c: Context) {
  return badRequest(c, "Invalid cursor")
}

export function internalServerError(
  c: Context,
  error = "Internal Server Error",
) {
  return errorResponse(c, error, 500)
}
