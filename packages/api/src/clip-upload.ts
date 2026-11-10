import type { InitiateClipResponse } from "@alloy/contracts"

import { abortError, isAbortError, throwIfAborted } from "./abort"
import { toError } from "./error"
import { HttpError, parseErrorMessagePayload } from "./http"
import { encodedPathSegment } from "./paths"
const UPLOAD_TIMEOUT_GRACE_MS = 30_000
const MIN_UPLOAD_TIMEOUT_MS = 30_000
// Each chunk and the completion request get this many tries on one ticket
// before the upload fails; transient errors back off 1s, then 2s.
const UPLOAD_REQUEST_ATTEMPTS = 3
const UPLOAD_RETRY_BASE_DELAY_MS = 1_000

/** A network failure or timeout that never produced an HTTP response. */
class UploadTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UploadTransportError"
  }
}

type XhrUploadOptions<T> = {
  url: string
  body: Blob
  timeoutMs: number
  signal?: AbortSignal
  onProgress?: (event: ProgressEvent) => void
  readSuccess: (xhr: XMLHttpRequest) => T
}

/**
 * Sends `body` as the initiated clip's source in numbered parts, then
 * completes it. A failed part is retried on the same ticket; any other
 * failure aborts the upload. The requests go to the page's own origin and
 * carry its session cookie, like every other clip write.
 */
export async function uploadClipSource(
  { clipId, ticket }: InitiateClipResponse,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const uploadPath = `/api/clips/${encodedPathSegment(clipId)}/upload`
  const chunkSize = ticket.chunkSizeBytes
  const partCount = Math.ceil(body.size / chunkSize)
  try {
    for (let index = 0; index < partCount; index += 1) {
      const start = index * chunkSize
      const end = Math.min(start + chunkSize, body.size)
      const chunk = body.slice(start, end)
      // Parts are addressed by number and the server replaces a part
      // atomically, so a failed chunk is re-sent on the same ticket.
      await withTransientRetry(
        () =>
          uploadPart(
            `${uploadPath}/chunks/${index + 1}`,
            chunk,
            ticket.expiresAt,
            (loaded) => onProgress(start + loaded, body.size),
            signal,
          ),
        signal,
      )
    }
    await withTransientRetry(
      () => postUploadComplete(`${uploadPath}/complete`, signal),
      signal,
    )
    onProgress(body.size, body.size)
  } catch (err) {
    await abortUpload(uploadPath)
    throw err
  }
}

function uploadPart(
  url: string,
  body: Blob,
  expiresAt: number,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return uploadWithXhr({
    url,
    body,
    signal,
    timeoutMs: ticketTimeoutMs(expiresAt),
    onProgress: (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    },
    readSuccess: () => undefined,
  })
}

async function withTransientRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    throwIfAborted(signal, "Upload aborted")
    try {
      return await run()
    } catch (err) {
      if (attempt >= UPLOAD_REQUEST_ATTEMPTS || !isTransientUploadError(err)) {
        throw err
      }
    }
    await waitBeforeRetry(
      UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
      signal,
    )
  }
}

function isTransientUploadError(cause: unknown): boolean {
  if (cause instanceof UploadTransportError) return true
  if (!(cause instanceof HttpError)) return false
  // 501 and 507 are permanent: the server lacks the feature or the disk.
  if (cause.status === 501 || cause.status === 507) return false
  return cause.status === 408 || cause.status === 429 || cause.status >= 500
}

function waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError("Upload aborted"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function uploadWithXhr<T>({
  url,
  body,
  timeoutMs,
  signal,
  onProgress,
  readSuccess,
}: XhrUploadOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const abortUpload = () => xhr.abort()
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener("abort", abortUpload)
      fn()
    }

    try {
      // Same origin, so the session cookie goes along without withCredentials.
      xhr.open("PUT", url)
      if (body.type) xhr.setRequestHeader("Content-Type", body.type)
    } catch (err) {
      settle(() => reject(toError(err, "Could not prepare upload request")))
      return
    }

    xhr.upload.onprogress = onProgress ?? null
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const message =
          parseErrorMessagePayload(xhr.responseText) ??
          `${xhr.status} ${xhr.statusText}`
        settle(() => reject(new HttpError(xhr.status, message)))
        return
      }
      try {
        const value = readSuccess(xhr)
        settle(() => resolve(value))
      } catch (err) {
        settle(() => reject(toError(err, "Upload failed")))
      }
    }
    xhr.onerror = () =>
      settle(() =>
        reject(new UploadTransportError("Network error during upload")),
      )
    xhr.ontimeout = () =>
      settle(() => reject(new UploadTransportError("Upload timed out")))
    xhr.onabort = () => settle(() => reject(abortError("Upload aborted")))
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener("abort", abortUpload, { once: true })
    }
    try {
      xhr.timeout = timeoutMs
      xhr.send(body)
    } catch (err) {
      settle(() => reject(toError(err, "Could not start upload")))
    }
  })
}

/** Until the ticket expires, plus a grace period; `expiresAt` is unix seconds. */
function ticketTimeoutMs(expiresAt: number): number {
  return Math.max(
    MIN_UPLOAD_TIMEOUT_MS,
    expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS,
  )
}

async function postUploadComplete(
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { method: "POST", signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new UploadTransportError(
      toError(err, "Network error during upload").message,
    )
  }
  if (!res.ok) throw new HttpError(res.status, await responseErrorMessage(res))
}

async function abortUpload(uploadPath: string): Promise<void> {
  try {
    await fetch(uploadPath, { method: "DELETE" })
  } catch {
    // Best effort: server maintenance also removes expired tickets.
  }
}

async function responseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return parseErrorMessagePayload(text) ?? `${res.status} ${res.statusText}`
}
