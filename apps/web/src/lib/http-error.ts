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

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return (await res.json().catch(() => null)) as ErrorBody
}

export async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new HttpError(
      res.status,
      body?.error ?? body?.message ?? `${res.status} ${res.statusText}`
    )
  }

  return (await res.json()) as T
}

export function isServerHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status >= 500
}
