import { logger } from "@alloy/logging"
import { DrizzleError, DrizzleQueryError } from "drizzle-orm"
import type { Context } from "hono"
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status"

import { errorMessage } from "./error-message"

/**
 * The statuses an error body is sent with. Typing them apart from 2xx lets
 * the API client infer each route's result without the error shape in it.
 */
export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode

function errorResponse<Status extends ErrorStatusCode>(
  c: Context,
  error: string,
  status: Status,
) {
  return c.json({ error }, status)
}

export function errorResult(
  c: Context,
  result: { error: string; status: ErrorStatusCode },
) {
  return errorResponse(c, result.error, result.status)
}

export function urlResponse(c: Context, url: string) {
  return c.json({ url })
}

export function success(c: Context) {
  return c.json({ success: true })
}

export function deleted(c: Context) {
  return c.json({ deleted: true })
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

export function tooManyRequests(
  c: Context,
  retryAfterSeconds: number,
  error = "Too many requests",
) {
  c.header("Retry-After", String(retryAfterSeconds))
  return errorResponse(c, error, 429)
}

export function badRequestFromCause(
  c: Context,
  cause: unknown,
  fallback: string,
) {
  if (cause instanceof DrizzleError || cause instanceof DrizzleQueryError) {
    logger.error("Database request failed", cause)
    return internalServerError(c, fallback)
  }
  return badRequest(c, errorMessage(cause, fallback))
}

export function invalidCursor(c: Context) {
  return badRequest(c, "Invalid cursor")
}

export function insufficientStorage(c: Context, error: string) {
  return errorResponse(c, error, 507)
}

export function internalServerError(
  c: Context,
  error = "Internal Server Error",
) {
  return errorResponse(c, error, 500)
}
