import type { UploadTicket } from "@alloy/contracts"

import { abortError, isAbortError, throwIfAborted } from "./abort"
import { toError } from "./error"
import { HttpError, parseErrorMessagePayload } from "./http"
import type { ApiJsonInput } from "./json-value"
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
  ticket: UploadTicket
  body: Blob
  timeoutMs: number
  signal?: AbortSignal
  onProgress?: (event: ProgressEvent) => void
  configure?: (xhr: XMLHttpRequest) => void
  readSuccess: (xhr: XMLHttpRequest) => T
}

export function uploadToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (ticket.strategy?.type === "chunked") {
    return uploadChunkedToTicket(ticket, body, onProgress, signal)
  }
  return uploadSingleToTicket(ticket, body, onProgress, signal)
}

function uploadSingleToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return uploadWithXhr({
    ticket,
    body,
    signal,
    timeoutMs: ticketTimeoutMs(ticket),
    configure: (xhr) => setContentTypeHeader(xhr, ticket.headers, body),
    onProgress: (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    },
    readSuccess: () => undefined,
  })
}

async function uploadChunkedToTicket(
  ticket: UploadTicket,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const strategy = ticket.strategy
  if (strategy?.type !== "chunked") {
    throw new Error("Upload ticket is not chunked")
  }
  const chunkSize = strategy.chunkSizeBytes
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
          uploadSingleToTicket(
            {
              uploadUrl: `${ticket.uploadUrl}/chunks/${index + 1}`,
              method: "PUT",
              headers: {},
              expiresAt: ticket.expiresAt,
            },
            chunk,
            (loaded) => onProgress(start + loaded, body.size),
            signal,
          ),
        signal,
      )
    }
    await withTransientRetry(
      () => postTicketControl(ticket.uploadUrl, "complete", undefined, signal),
      signal,
    )
    onProgress(body.size, body.size)
  } catch (err) {
    await abortTicketUpload(ticket.uploadUrl)
    throw err
  }
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
  ticket,
  body,
  timeoutMs,
  signal,
  onProgress,
  configure,
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
      xhr.open(ticket.method, ticket.uploadUrl)
      xhr.withCredentials = false
      for (const [name, value] of Object.entries(ticket.headers)) {
        xhr.setRequestHeader(name, value)
      }
      configure?.(xhr)
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

function setContentTypeHeader(
  xhr: XMLHttpRequest,
  headers: Record<string, string>,
  body: Blob,
): void {
  const hasContentType = Object.keys(headers).some(
    (name) => name.toLowerCase() === "content-type",
  )
  if (!hasContentType && body.type) {
    xhr.setRequestHeader("Content-Type", body.type)
  }
}

function ticketTimeoutMs(ticket: UploadTicket): number {
  return Math.max(
    MIN_UPLOAD_TIMEOUT_MS,
    ticket.expiresAt * 1000 - Date.now() + UPLOAD_TIMEOUT_GRACE_MS,
  )
}

async function postTicketControl(
  uploadUrl: string,
  suffix: string,
  json: ApiJsonInput,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${uploadUrl}/${suffix}`, {
      method: "POST",
      headers:
        json === undefined ? undefined : { "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new UploadTransportError(
      toError(err, "Network error during upload").message,
    )
  }
  if (!res.ok) throw new HttpError(res.status, await responseErrorMessage(res))
}

async function abortTicketUpload(uploadUrl: string): Promise<void> {
  try {
    await fetch(uploadUrl, { method: "DELETE" })
  } catch {
    // Best effort: server maintenance also removes expired tickets.
  }
}

async function responseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return parseErrorMessagePayload(text) ?? `${res.status} ${res.statusText}`
}
