export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

type ErrorBody = {
  error?: string
  message?: string
} | null

function isJsonResponse(res: Response): boolean {
  const contentType = res.headers.get("Content-Type")?.toLowerCase()
  return (
    contentType?.includes("application/json") ||
    contentType?.includes("+json")
  ) ?? false
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  if (!isJsonResponse(res)) return null
  return (await res.json().catch(() => null)) as ErrorBody
}

async function readUnexpectedBodyType(res: Response): Promise<string> {
  const contentType = res.headers.get("Content-Type") ?? "unknown content type"
  const body = await res.text().catch(() => "")
  const trimmed = body.trim()
  const suffix = trimmed ? `: ${trimmed.slice(0, 80)}` : ""
  return `Expected JSON response but received ${contentType}${suffix}`
}

export async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new HttpError(
      res.status,
      body?.error ?? body?.message ?? `${res.status} ${res.statusText}`
    )
  }

  if (!isJsonResponse(res)) {
    throw new HttpError(res.status, await readUnexpectedBodyType(res))
  }

  return (await res.json()) as T
}

export function isServerHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status >= 500
}
