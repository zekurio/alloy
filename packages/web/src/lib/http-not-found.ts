import { HttpError } from "@alloy/api"

/** The API answered 404: the resource doesn't exist, so retrying can't help. */
export function isHttpNotFound(cause: unknown): boolean {
  return cause instanceof HttpError && cause.status === 404
}
