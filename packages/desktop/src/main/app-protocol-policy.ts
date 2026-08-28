import {
  DESKTOP_APP_DOCUMENT,
  DESKTOP_APP_HOST,
  DESKTOP_APP_ORIGIN,
  DESKTOP_APP_SCHEME,
  DESKTOP_APP_URL,
} from "@alloy/contracts"

import type { UntrustedInput, UntrustedRecord } from "./runtime-validation"
import { parseString, parseUntrustedRecord } from "./runtime-validation"
import { isSecureServerUrl } from "./url-policy"

export const APP_PROTOCOL = DESKTOP_APP_SCHEME
export const APP_HOST = DESKTOP_APP_HOST
export const APP_ORIGIN = DESKTOP_APP_ORIGIN
export const APP_DOCUMENT = DESKTOP_APP_DOCUMENT
export const APP_URL = DESKTOP_APP_URL

const API_PATH = "/api"
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-event-id",
  "pragma",
  "range",
  "x-request-id",
])
const PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])

export type AppRequestRoute =
  | { kind: "file"; relativePath: string }
  | { kind: "api"; targetUrl: string }
  | {
      kind: "reject"
      status: 400 | 403 | 404 | 405 | 503
      reason:
        | "invalid-url"
        | "invalid-origin"
        | "invalid-path"
        | "method-not-allowed"
        | "missing-server"
    }

/** Parse a request without letting URL canonicalization hide dot segments. */
export function mapAppRequest(
  rawUrl: string,
  method: string,
  selectedServerUrl: string | null,
): AppRequestRoute {
  const requestUrl = parseAppUrl(rawUrl)
  if (!requestUrl) {
    return { kind: "reject", status: 404, reason: "invalid-origin" }
  }

  const pathname = decodeSafePath(requestUrl.rawPath)
  if (pathname === null) {
    return { kind: "reject", status: 400, reason: "invalid-path" }
  }

  if (isApiPath(pathname)) {
    const normalizedMethod = method.toUpperCase()
    if (!PROXY_METHODS.has(normalizedMethod)) {
      return { kind: "reject", status: 405, reason: "method-not-allowed" }
    }
    if (!selectedServerUrl) {
      return { kind: "reject", status: 503, reason: "missing-server" }
    }
    const targetUrl = selectedServerResourceUrl(rawUrl, selectedServerUrl)
    if (!targetUrl) {
      return { kind: "reject", status: 400, reason: "invalid-url" }
    }
    return { kind: "api", targetUrl }
  }

  if (method !== "GET" && method !== "HEAD") {
    return { kind: "reject", status: 405, reason: "method-not-allowed" }
  }
  return {
    kind: "file",
    relativePath: pathname === "/" ? APP_DOCUMENT : pathname.replace(/^\//, ""),
  }
}

/**
 * Translate a local API URL to the selected server. Direct server URLs are
 * accepted only when their origin is the selected server's exact origin.
 */
export function appProxyUrlForSelectedServerResource(
  rawUrl: string,
  selectedServerUrl: string,
): string | null {
  const serverOrigin = normalizeSelectedServerUrl(selectedServerUrl)
  if (!serverOrigin) return null
  try {
    const resource = new URL(rawUrl)
    if (
      resource.origin !== serverOrigin ||
      !isApiPath(resource.pathname) ||
      resource.username ||
      resource.password
    ) {
      return null
    }
    return `${APP_ORIGIN}${resource.pathname}${resource.search}${resource.hash}`
  } catch {
    return null
  }
}

export function translateSelectedServerUploadTicket(
  value: UntrustedInput,
  selectedServerUrl: string,
): UntrustedRecord | null {
  const envelope = parseUntrustedRecord(value)
  const ticket = parseUntrustedRecord(envelope?.ticket)
  const uploadUrl = parseString(ticket?.uploadUrl)
  if (!envelope || !ticket || !uploadUrl) return null

  if (!normalizeSelectedServerUrl(selectedServerUrl)) return null

  let parsed: URL
  try {
    parsed = new URL(uploadUrl)
  } catch {
    return null
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith("/api/assets/upload/")
  ) {
    return null
  }

  // Filesystem tickets may name the server's configured public origin instead
  // of the alias the user connected through. Only their signed path/query is
  // retained; the proxy still sends the upload to the selected server.
  const localUrl = `${APP_ORIGIN}${parsed.pathname}${parsed.search}`
  return { ...envelope, ticket: { ...ticket, uploadUrl: localUrl } }
}

export function selectedServerResourceUrl(
  rawUrl: string,
  selectedServerUrl: string,
): string | null {
  const serverOrigin = normalizeSelectedServerUrl(selectedServerUrl)
  if (!serverOrigin) return null

  const appUrl = parseAppUrl(rawUrl)
  if (appUrl) {
    const pathname = decodeSafePath(appUrl.rawPath)
    if (pathname === null || !isApiPath(pathname)) return null
    const target = new URL(serverOrigin)
    target.pathname = pathname
    target.search = appUrl.url.search
    return target.toString()
  }

  try {
    const resource = new URL(rawUrl)
    if (
      (resource.protocol !== "https:" && resource.protocol !== "http:") ||
      resource.origin !== serverOrigin
    ) {
      return null
    }
    return resource.toString()
  } catch {
    return null
  }
}

export function normalizeSelectedServerUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return null
    if (!isSecureServerUrl(url)) return null
    return url.origin
  } catch {
    return null
  }
}

export function isTrustedAppDocumentUrl(
  rawUrl: string,
  devDocumentUrl: string | null,
): boolean {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol === `${APP_PROTOCOL}:` &&
      url.hostname === APP_HOST &&
      url.pathname === `/${APP_DOCUMENT}` &&
      url.search === "" &&
      !url.username &&
      !url.password &&
      !url.port
    ) {
      return true
    }
    if (!devDocumentUrl) return false
    const expected = new URL(devDocumentUrl)
    return (
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      url.search === expected.search
    )
  } catch {
    return false
  }
}

export function isAllowedProxyOrigin(
  origin: string | null,
  devRendererOrigin: string | null,
): boolean {
  return (
    origin === null ||
    origin === APP_ORIGIN ||
    (devRendererOrigin !== null && origin === devRendererOrigin)
  )
}

export function forwardedProxyRequestHeaders(
  input: Headers,
  serverOrigin: string,
): Headers {
  const output = new Headers()
  for (const [name, value] of input) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      output.append(name, value)
    }
  }
  // The proxy is the same-origin boundary. Never forward the custom renderer
  // origin or renderer-controlled browser metadata to the HTTP server.
  output.set("Accept-Encoding", "identity")
  output.set("Origin", serverOrigin)
  output.set("Sec-Fetch-Site", "same-origin")
  return output
}

export function requestedPreflightHeadersAreAllowed(
  value: string | null,
): boolean {
  if (!value) return true
  return value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .every((name) => FORWARDED_REQUEST_HEADERS.has(name))
}

export function isAllowedProxyMethod(method: string): boolean {
  return PROXY_METHODS.has(method.toUpperCase())
}

export function isRejectedProxyRedirect(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304
}

function isApiPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)
}

interface ParsedAppUrl {
  url: URL
  rawPath: string
}

function parseAppUrl(rawUrl: string): ParsedAppUrl | null {
  if (!rawUrl.startsWith(`${APP_PROTOCOL}://`)) return null

  const afterScheme = rawUrl.slice(`${APP_PROTOCOL}://`.length)
  const separatorIndex = afterScheme.search(/[/?#]/)
  const authority =
    separatorIndex === -1 ? afterScheme : afterScheme.slice(0, separatorIndex)
  if (authority.toLowerCase() !== APP_HOST) return null

  const pathAndRest =
    separatorIndex === -1 ? "/" : afterScheme.slice(separatorIndex)
  const rawPath = pathAndRest.startsWith("/")
    ? pathAndRest.split(/[?#]/, 1)[0]
    : "/"

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${APP_PROTOCOL}:` ||
    url.hostname !== APP_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null
  }
  return { url, rawPath }
}

function decodeSafePath(rawPath: string): string | null {
  if (
    !rawPath.startsWith("/") ||
    rawPath.includes("\\") ||
    /%(?![0-9A-Fa-f]{2})/.test(rawPath) ||
    /%(?:2f|5c)/i.test(rawPath)
  ) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    hasControlCharacter(decoded) ||
    decoded.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null
  }
  return decoded
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}
