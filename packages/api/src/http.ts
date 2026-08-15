import { isObjectRecord, isStringValue } from "@alloy/contracts"

import type { JsonValidator } from "./auth-validators"
import type { ApiJsonInput, ApiJsonValue } from "./json-value"
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

type ErrorBody = {
  error?: ApiJsonValue
  message?: ApiJsonValue
} | null

function isJsonResponse(res: Response): boolean {
  const contentType = res.headers.get("Content-Type")?.toLowerCase()
  return (
    (contentType?.includes("application/json") ||
      contentType?.includes("+json")) ??
    false
  )
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  if (!isJsonResponse(res)) return null
  return res
    .json()
    .then(asErrorBody)
    .catch(() => null)
}

function asErrorBody(value: ApiJsonInput): ErrorBody {
  if (!isObjectRecord(value)) return null
  return { error: value.error, message: value.message }
}

function errorText(value: ApiJsonInput): string | null {
  if (isStringValue(value)) {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (!isObjectRecord(value)) return null

  const message = value.message
  if (isStringValue(message) && message.trim()) return message.trim()

  const issues = value.issues
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      const issueMessage = isObjectRecord(issue) ? issue.message : null
      if (isStringValue(issueMessage) && issueMessage.trim()) {
        return issueMessage.trim()
      }
    }
  }

  return null
}

function responseErrorMessage(res: Response, body: ErrorBody): string {
  return (
    errorText(body?.error) ??
    errorText(body?.message) ??
    `${res.status} ${res.statusText}`
  )
}

export function parseJsonPayload<T>(
  data: string,
  validate: (value: ApiJsonInput) => T,
): T | null {
  try {
    return validate(JSON.parse(data))
  } catch {
    return null
  }
}

export function parseErrorMessagePayload(data: string): string | null {
  try {
    const body = asErrorBody(JSON.parse(data))
    return errorText(body?.error) ?? errorText(body?.message)
  } catch {
    return null
  }
}

async function readUnexpectedBodyType(res: Response): Promise<string> {
  const contentType = res.headers.get("Content-Type") ?? "unknown content type"
  const body = await res.text().catch(() => "")
  const trimmed = body.trim()
  const suffix = trimmed ? `: ${trimmed.slice(0, 80)}` : ""
  return `Expected JSON response but received ${contentType}${suffix}`
}

export type { JsonValidator } from "./auth-validators"

export async function readJsonOrThrow<T>(
  res: Response,
  validate: JsonValidator<T>,
): Promise<T> {
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new HttpError(res.status, responseErrorMessage(res, body))
  }

  if (!isJsonResponse(res)) {
    throw new HttpError(res.status, await readUnexpectedBodyType(res))
  }

  return validate(await res.json())
}

export async function readNoContentOrThrow(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new HttpError(res.status, responseErrorMessage(res, body))
  }

  if (res.status !== 204) {
    throw new HttpError(
      res.status,
      `Expected empty response but received ${res.status} ${res.statusText}`,
    )
  }
}

export function isServerHttpError(cause: unknown): cause is HttpError {
  return cause instanceof HttpError && cause.status >= 500
}
