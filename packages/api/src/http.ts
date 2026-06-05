import type { JsonValidator } from "./auth-validators"

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

type ErrorBody = {
  error?: unknown
  message?: unknown
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
  try {
    return asErrorBody(await res.json())
  } catch {
    return null
  }
}

function asErrorBody(value: unknown): ErrorBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as ErrorBody
}

function errorText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (!value || typeof value !== "object") return null

  const message = (value as { message?: unknown }).message
  if (typeof message === "string" && message.trim()) return message.trim()

  const issues = (value as { issues?: unknown }).issues
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      const issueMessage =
        issue && typeof issue === "object"
          ? (issue as { message?: unknown }).message
          : null
      if (typeof issueMessage === "string" && issueMessage.trim()) {
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
  validate: (value: unknown) => T,
): T | null {
  try {
    return validate(JSON.parse(data) as unknown)
  } catch {
    return null
  }
}

export function parseErrorMessagePayload(data: string): string | null {
  try {
    const body = asErrorBody(JSON.parse(data) as unknown)
    return errorText(body?.error) ?? errorText(body?.message)
  } catch {
    return null
  }
}

async function readUnexpectedBodyType(res: Response): Promise<string> {
  const contentType = res.headers.get("Content-Type") ?? "unknown content type"
  let body = ""
  try {
    body = await res.text()
  } catch {
    body = ""
  }
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

export function isServerHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status >= 500
}
