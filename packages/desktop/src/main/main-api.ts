import { createReadStream, statSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import type {
  GameSessionRow,
  InitiateClipInput,
  InitiateClipResponse,
  RegisterDeviceInput,
  UploadTicket,
  UpsertGameSessionInput,
  UserDeviceRow,
} from "@alloy/contracts"

import { mainSession } from "./session"

/**
 * Minimal authenticated API client for the main process (the sync engine runs
 * with no window open, so it can't go through the renderer's RPC client).
 *
 * Requests use Node's fetch with the session cookie attached by hand — the
 * same pattern as `hasValidSession`. Node sends neither Origin nor
 * Sec-Fetch-Site, so the server's CSRF middleware falls through to allow;
 * `mainSession().fetch` must NOT be used here because Chromium can attach
 * `Sec-Fetch-Site: none`, which the middleware rejects.
 */

export class MainApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "MainApiError"
  }
}

export async function sessionCookieHeader(
  serverUrl: string,
): Promise<string | null> {
  const [cookie] = await mainSession().cookies.get({
    url: serverUrl,
    name: "alloy_session",
  })
  return cookie ? `alloy_session=${cookie.value}` : null
}

export async function hasSessionCookie(serverUrl: string): Promise<boolean> {
  return (await sessionCookieHeader(serverUrl)) !== null
}

async function apiRequest<T>(
  serverUrl: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const cookie = await sessionCookieHeader(serverUrl)
  if (!cookie) throw new MainApiError("Not signed in.", 401)

  const response = await fetch(new URL(path, serverUrl), {
    method,
    headers: {
      Cookie: cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let message = `The server answered ${response.status}.`
    try {
      const parsed: unknown = await response.json()
      const error = (parsed as { error?: unknown } | null)?.error
      if (typeof error === "string" && error.length > 0) message = error
    } catch {
      // Non-JSON error bodies keep the status fallback.
    }
    throw new MainApiError(message, response.status)
  }
  return (await response.json()) as T
}

export function initiateClip(
  serverUrl: string,
  input: InitiateClipInput,
): Promise<InitiateClipResponse> {
  return apiRequest(serverUrl, "POST", "/api/clips/initiate", input)
}

export function finalizeClip(serverUrl: string, clipId: string): Promise<void> {
  return apiRequest(serverUrl, "POST", `/api/clips/${clipId}/finalize`)
}

export function failClip(serverUrl: string, clipId: string): Promise<void> {
  return apiRequest(serverUrl, "POST", `/api/clips/${clipId}/fail`)
}

export function deleteClip(serverUrl: string, clipId: string): Promise<void> {
  return apiRequest(serverUrl, "DELETE", `/api/clips/${clipId}`)
}

export function registerDevice(
  serverUrl: string,
  deviceId: string,
  input: RegisterDeviceInput,
): Promise<{ device: UserDeviceRow }> {
  return apiRequest(serverUrl, "PUT", `/api/devices/${deviceId}`, input)
}

export function upsertGameSession(
  serverUrl: string,
  sessionId: string,
  input: UpsertGameSessionInput,
): Promise<{ session: GameSessionRow }> {
  return apiRequest(serverUrl, "PUT", `/api/sessions/${sessionId}`, input)
}

/** Socket-inactivity deadline; large uploads keep resetting it with traffic. */
const UPLOAD_IDLE_TIMEOUT_MS = 60_000

/**
 * Streams a file to an upload ticket target with byte-level progress and
 * abort. Tickets are presigned S3 PUTs or token-authenticated server POSTs;
 * both want an explicit Content-Length (S3 rejects chunked encoding) and
 * neither needs cookies. Progress counts bytes read off disk — backpressure
 * through pipe() keeps that within a buffer of what actually went out.
 */
export function uploadFileToTicket(
  ticket: UploadTicket,
  filePath: string,
  onProgress: (sentBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let totalBytes: number
    try {
      totalBytes = statSync(filePath).size
    } catch (cause) {
      rejectPromise(
        cause instanceof Error ? cause : new Error("Capture file is missing."),
      )
      return
    }

    const url = new URL(ticket.uploadUrl)
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest
    const request = requestFn(
      url,
      {
        method: ticket.method,
        headers: { ...ticket.headers, "Content-Length": String(totalBytes) },
      },
      (response) => {
        // Drain the body so the socket can close cleanly.
        response.resume()
        response.on("end", () => {
          const status = response.statusCode ?? 0
          if (status >= 200 && status < 300) {
            resolvePromise()
          } else {
            rejectPromise(new Error(`The upload target answered ${status}.`))
          }
        })
      },
    )
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error("The upload timed out."))
    })

    const onAbort = () => request.destroy(new Error("Upload aborted."))
    signal.addEventListener("abort", onAbort, { once: true })
    request.on("error", (cause) => rejectPromise(cause))
    request.on("close", () => signal.removeEventListener("abort", onAbort))

    let sentBytes = 0
    const source = createReadStream(filePath)
    source.on("data", (chunk: string | Buffer) => {
      sentBytes += chunk.length
      onProgress(sentBytes, totalBytes)
    })
    source.on("error", (cause) => request.destroy(cause))
    source.pipe(request)
  })
}
