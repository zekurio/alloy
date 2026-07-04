import type { UploadTicket } from "@alloy/contracts"

import { toError } from "./error"
import { parseErrorMessagePayload } from "./http"

const UPLOAD_TIMEOUT_GRACE_MS = 30_000
const MIN_UPLOAD_TIMEOUT_MS = 30_000

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
      throwIfAborted(signal)
      const start = index * chunkSize
      const end = Math.min(start + chunkSize, body.size)
      await uploadSingleToTicket(
        {
          uploadUrl: `${ticket.uploadUrl}/chunks/${index + 1}`,
          method: "PUT",
          headers: {},
          expiresAt: ticket.expiresAt,
        },
        body.slice(start, end),
        (loaded) => onProgress(start + loaded, body.size),
        signal,
      )
    }
    throwIfAborted(signal)
    await postTicketControl(ticket.uploadUrl, "complete", undefined, signal)
    onProgress(body.size, body.size)
  } catch (err) {
    await abortTicketUpload(ticket.uploadUrl)
    throw err
  }
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
        settle(() => reject(new Error(message)))
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
      settle(() => reject(new Error("Network error during upload")))
    xhr.ontimeout = () => settle(() => reject(new Error("Upload timed out")))
    xhr.onabort = () =>
      settle(() => reject(new DOMException("Upload aborted", "AbortError")))
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
  json: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${uploadUrl}/${suffix}`, {
    method: "POST",
    headers:
      json === undefined ? undefined : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
    signal,
  })
  if (!res.ok) throw new Error(await responseErrorMessage(res))
}

async function abortTicketUpload(uploadUrl: string): Promise<void> {
  try {
    await fetch(uploadUrl, { method: "DELETE" })
  } catch {
    // Best effort: the server's `upload.reap-tickets` cleanup job also removes
    // expired tickets.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError")
}

async function responseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return parseErrorMessagePayload(text) ?? `${res.status} ${res.statusText}`
}
