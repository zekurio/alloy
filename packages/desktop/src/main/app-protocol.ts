import { createReadStream, realpathSync, statSync } from "node:fs"
import { extname, isAbsolute, relative, resolve } from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"

import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { appRendererRoot } from "./app-protocol-files"
import {
  APP_DOCUMENT,
  APP_PROTOCOL,
  APP_URL,
  forwardedProxyRequestHeaders,
  isAllowedProxyMethod,
  isAllowedProxyOrigin,
  isRejectedProxyRedirect,
  isStreamingProxyUpload,
  mapAppRequest,
  normalizeSelectedServerUrl,
  requestedPreflightHeadersAreAllowed,
  translateSelectedServerUploadTicket,
} from "./app-protocol-policy"
import {
  proxyResponseBody,
  responseHeaderDeadline,
} from "./app-protocol-stream"
import { mainSession } from "./session"

const logger = createLogger("app-protocol")
const RENDERER_ROOT = appRendererRoot(app.getAppPath())
const RESPONSE_HEADERS_TO_DROP = new Set([
  // Electron fetch may decode the body before the protocol response sees it.
  // Dropping length also means renderer downloads cannot show an upstream
  // total, but avoids forwarding a stale compressed byte count.
  "content-encoding",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])
const MAX_UPLOAD_INITIATE_RESPONSE_BYTES = 256 * 1024
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

let selectedServerUrl: string | null = null
let registered = false

export { APP_URL }

export function appProtocolScheme(): Electron.CustomScheme {
  return {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  }
}

/** Select the only HTTP origin the local app protocol may reach. */
export function selectAppProtocolServer(serverUrl: string): void {
  const normalized = normalizeSelectedServerUrl(serverUrl)
  if (!normalized) throw new Error("Invalid Alloy server URL.")
  selectedServerUrl = normalized
}

export function selectedAppProtocolServer(): string | null {
  return selectedServerUrl
}

export function clearAppProtocolServer(): void {
  selectedServerUrl = null
}

/** Register the main-partition handler after Electron is ready. */
export function registerAppProtocol(): void {
  if (registered) return
  registered = true

  mainSession().protocol.handle(APP_PROTOCOL, async (request) => {
    const devOrigin = devRendererOrigin()
    const requestOrigin = request.headers.get("origin")
    if (!isAllowedProxyOrigin(requestOrigin, devOrigin)) {
      return textResponse(403, "Forbidden")
    }

    if (request.method === "OPTIONS") {
      const requestedMethod =
        request.headers.get("access-control-request-method")?.toUpperCase() ??
        ""
      const preflightRoute = mapAppRequest(
        request.url,
        requestedMethod,
        selectedServerUrl,
      )
      if (preflightRoute.kind !== "api") {
        return preflightRoute.kind === "reject"
          ? textResponse(
              preflightRoute.status,
              statusText(preflightRoute.status),
            )
          : textResponse(404, "Not found")
      }
      return preflightResponse(request, devOrigin, requestedMethod)
    }

    const route = mapAppRequest(request.url, request.method, selectedServerUrl)
    if (route.kind === "reject") {
      return proxyErrorResponse(
        route.status,
        statusText(route.status),
        request,
        devOrigin,
      )
    }
    if (route.kind === "api") {
      return proxyApiRequest(request, route.targetUrl, devOrigin)
    }
    return rendererFileResponse(route.relativePath, request)
  })
}

async function proxyApiRequest(
  request: Request,
  targetUrl: string,
  devOrigin: string | null,
): Promise<Response> {
  const target = new URL(targetUrl)
  const headers = forwardedProxyRequestHeaders(request.headers, target.origin)
  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.body
  const streamingUpload = isStreamingProxyUpload(
    request.method,
    target.pathname,
    request.headers.get("content-type"),
  )
  const deadline = streamingUpload
    ? null
    : responseHeaderDeadline(request.signal)
  try {
    let response: Response
    try {
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
        body: requestBody,
        credentials: target.pathname.startsWith("/api/assets/upload/")
          ? "omit"
          : "include",
        redirect: "manual",
        signal: deadline?.signal ?? request.signal,
        duplex: requestBody ? "half" : undefined,
      }
      response = await mainSession().fetch(targetUrl, init)
    } finally {
      deadline?.clear()
    }
    if (isRejectedProxyRedirect(response.status)) {
      response.body?.cancel().catch(() => undefined)
      return proxyErrorResponse(
        502,
        "Upstream redirect rejected",
        request,
        devOrigin,
      )
    }

    const translatedTicket = await translatedUploadTicketResponse(
      request,
      target,
      response,
      devOrigin,
    )
    if (translatedTicket) return translatedTicket

    const responseHeaders = proxyResponseHeaders(response.headers)
    addDevCorsHeaders(responseHeaders, request.headers.get("origin"), devOrigin)
    return new Response(
      request.method === "HEAD"
        ? null
        : proxyResponseBody(response.body, request.signal),
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      },
    )
  } catch (cause) {
    if (request.signal.aborted) throw cause
    if (deadline?.timedOut()) {
      logger.warn("API proxy response header timed out:", cause)
      return proxyErrorResponse(504, "Gateway timeout", request, devOrigin)
    }
    logger.warn("API proxy request failed:", cause)
    return proxyErrorResponse(502, "Bad gateway", request, devOrigin)
  }
}

async function translatedUploadTicketResponse(
  request: Request,
  target: URL,
  response: Response,
  devOrigin: string | null,
): Promise<Response | null> {
  if (
    request.method !== "POST" ||
    target.pathname !== "/api/clips/initiate" ||
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return null
  }

  const body = await readBoundedJson(
    response,
    MAX_UPLOAD_INITIATE_RESPONSE_BYTES,
  )
  if (body.kind === "too-large") {
    await response.body?.cancel().catch(() => undefined)
    return proxyErrorResponse(
      502,
      "Upload response exceeded the byte limit",
      request,
      devOrigin,
    )
  }
  if (body.kind === "invalid") return null

  const translated = translateSelectedServerUploadTicket(
    body.value,
    target.origin,
  )
  if (!translated) return null
  await response.body?.cancel().catch(() => undefined)

  const headers = proxyResponseHeaders(response.headers)
  headers.delete("Content-Encoding")
  headers.delete("Content-Length")
  headers.delete("ETag")
  headers.set("Content-Type", "application/json; charset=utf-8")
  addDevCorsHeaders(headers, request.headers.get("origin"), devOrigin)
  return new Response(JSON.stringify(translated), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

type BoundedJsonResult =
  | { kind: "value"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too-large" }

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const declaredBytes = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return { kind: "too-large" }
  }

  const reader = response.clone().body?.getReader()
  if (!reader) return { kind: "invalid" }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { kind: "too-large" }
      }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks, total).toString("utf8")
    return { kind: "value", value: JSON.parse(text) }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { kind: "invalid" }
  }
}

function preflightResponse(
  request: Request,
  devOrigin: string | null,
  requestedMethod: string,
): Response {
  const origin = request.headers.get("origin")
  if (
    !devOrigin ||
    origin !== devOrigin ||
    !isAllowedProxyMethod(requestedMethod) ||
    !requestedPreflightHeadersAreAllowed(
      request.headers.get("access-control-request-headers"),
    )
  ) {
    return textResponse(403, "Forbidden")
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        request.headers.get("access-control-request-headers") ?? "",
      "Access-Control-Allow-Methods": requestedMethod,
      "Access-Control-Allow-Origin": devOrigin,
      "Access-Control-Max-Age": "600",
      Vary: "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
    },
  })
}

function rendererFileResponse(
  relativePath: string,
  request: Request,
): Response {
  const requested = safeRendererFile(relativePath)
  const file =
    requested ??
    (acceptsDocument(request) ? safeRendererFile(APP_DOCUMENT) : null)
  if (!file) return textResponse(404, "Not found")

  let size: number
  try {
    size = statSync(file).size
  } catch {
    return textResponse(404, "Not found")
  }
  const headers = new Headers({
    "Cache-Control":
      file.endsWith(`/${APP_DOCUMENT}`) || file.endsWith(`\\${APP_DOCUMENT}`)
        ? "no-cache"
        : "public, max-age=3600",
    "Content-Length": String(size),
    "Content-Type":
      CONTENT_TYPES.get(extname(file).toLowerCase()) ??
      "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  })
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers })
  }

  const stream = createReadStream(file)
  return new Response(fileBodyStream(stream), { status: 200, headers })
}

function safeRendererFile(relativePath: string): string | null {
  if (!relativePath || isAbsolute(relativePath)) return null

  let root: string
  let candidate: string
  try {
    root = realpathSync(RENDERER_ROOT)
    candidate = realpathSync(resolve(root, relativePath))
  } catch {
    return null
  }
  const fromRoot = relative(root, candidate)
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

function acceptsDocument(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false
  return request.headers.get("accept")?.includes("text/html") === true
}

function proxyResponseHeaders(input: Headers): Headers {
  const output = new Headers()
  for (const [name, value] of input) {
    if (!RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) {
      output.append(name, value)
    }
  }
  return output
}

function addDevCorsHeaders(
  headers: Headers,
  requestOrigin: string | null,
  devOrigin: string | null,
): void {
  if (!devOrigin || requestOrigin !== devOrigin) return
  headers.set("Access-Control-Allow-Credentials", "true")
  headers.set("Access-Control-Allow-Origin", devOrigin)
  headers.set(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range, ETag, X-Request-Id",
  )
  headers.append("Vary", "Origin")
}

function fileBodyStream(
  stream: Readable,
): globalThis.ReadableStream<Uint8Array> {
  const webStream: ReadableStream<Uint8Array> = Readable.toWeb(stream)
  // SAFETY: Node and DOM ReadableStream use the same byte-stream interface.
  return webStream as globalThis.ReadableStream<Uint8Array>
}

function devRendererOrigin(): string | null {
  if (app.isPackaged) return null
  const rawUrl = process.env.ELECTRON_RENDERER_URL
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    return url.origin
  } catch {
    return null
  }
}

function statusText(status: number): string {
  switch (status) {
    case 400:
      return "Bad request"
    case 403:
      return "Forbidden"
    case 404:
      return "Not found"
    case 405:
      return "Method not allowed"
    case 503:
      return "No server selected"
    default:
      return "Request failed"
  }
}

function proxyErrorResponse(
  status: number,
  body: string,
  request: Request,
  devOrigin: string | null,
): Response {
  const response = textResponse(status, body)
  addDevCorsHeaders(response.headers, request.headers.get("origin"), devOrigin)
  return response
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
