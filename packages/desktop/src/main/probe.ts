import {
  DESKTOP_AUTH_CAPABILITY_VERSION,
  type PublicAuthConfig,
} from "@alloy/contracts"
import { logger } from "@alloy/logging"

import type { ProbeResult } from "@/shared/ipc"

import { isSecureServerUrl } from "./url-policy"

const PROBE_TIMEOUT_MS = 8000
const AUTH_CONFIG_PATH = "/api/auth-config"

/**
 * Turn raw user input into an ordered list of candidate base URLs to probe.
 * Mirrors what a browser address bar tolerates: bare hosts, missing scheme,
 * trailing slashes, and an accidental `/api` suffix. Bare non-local hosts only
 * produce HTTPS candidates; HTTP is accepted for loopback development only.
 */
export function candidateUrls(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const hasScheme = /^https?:\/\//i.test(trimmed)
  const withScheme = hasScheme
    ? [trimmed]
    : [`https://${trimmed}`, `http://${trimmed}`]

  const bases: string[] = []
  for (const raw of withScheme) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    // Drop a trailing `/api`, query, and hash so we always probe the origin's
    // app root regardless of what the user pasted.
    url.pathname = url.pathname.replace(/\/api\/?$/, "").replace(/\/+$/, "")
    url.search = ""
    url.hash = ""
    if (!isSecureServerUrl(url)) continue
    const normalized = url.toString().replace(/\/+$/, "")
    if (!bases.includes(normalized)) bases.push(normalized)
  }
  return bases
}

function isPublicAuthConfig(value: unknown): value is PublicAuthConfig {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.passkeyEnabled === "boolean" &&
    typeof v.openRegistrations === "boolean" &&
    typeof v.setupRequired === "boolean" &&
    typeof (v.desktopAuth as { version?: unknown } | undefined)?.version ===
      "number" &&
    Array.isArray(v.providers)
  )
}

function supportsDesktopAuth(config: PublicAuthConfig): boolean {
  return config.desktopAuth.version >= DESKTOP_AUTH_CAPABILITY_VERSION
}

async function probeOne(baseUrl: string): Promise<ProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}${AUTH_CONFIG_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `Server responded with ${res.status}.` }
    }
    const body: unknown = await res.json()
    if (!isPublicAuthConfig(body)) {
      return { ok: false, error: "Not an Alloy server." }
    }
    if (!supportsDesktopAuth(body)) {
      return {
        ok: false,
        error: "This Alloy server does not support desktop login yet.",
      }
    }
    return { ok: true, serverUrl: baseUrl, config: body }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "Connection timed out."
        : "Could not reach server."
    return { ok: false, error: reason }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Validate a user-entered server URL by fetching its public auth config from
 * the main process (native fetch — no CORS, unlike the renderer). Returns the
 * first reachable candidate, or the last failure reason.
 */
export async function probeServer(input: string): Promise<ProbeResult> {
  const candidates = candidateUrls(input)
  if (candidates.length === 0) {
    return input.trim()
      ? {
          ok: false,
          error: "Desktop requires HTTPS outside localhost.",
        }
      : { ok: false, error: "Enter a server URL." }
  }

  let lastError = "Could not reach server."
  for (const candidate of candidates) {
    const result = await probeOne(candidate)
    if (result.ok) return result
    lastError = result.error
    logger.warn(`[desktop] probe failed for ${candidate}: ${result.error}`)
  }
  return { ok: false, error: lastError }
}
