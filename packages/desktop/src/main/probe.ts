import {
  DESKTOP_AUTH_CAPABILITY_VERSION,
  type PublicAuthConfig,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { getRuntimeLocale, translate } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"

import type { ProbeResult } from "@/shared/ipc"

import {
  StrictBooleanSchema,
  StrictFiniteNumberSchema,
  StrictStringSchema,
} from "./runtime-validation"
import { isSecureServerUrl } from "./url-policy"

const logger = createLogger("probe")

const PROBE_TIMEOUT_MS = 8000
const AUTH_CONFIG_PATH = "/api/auth-config"
const PublicAuthConfigSchema = t.looseObject({
  adminAccountRequired: StrictBooleanSchema,
  setupRequired: StrictBooleanSchema,
  openRegistrations: StrictBooleanSchema,
  passkeyEnabled: StrictBooleanSchema,
  requireAuthToBrowse: StrictBooleanSchema,
  desktopAuth: t.looseObject({ version: StrictFiniteNumberSchema }),
  providers: t.array(
    t.looseObject({
      providerId: StrictStringSchema,
      displayName: StrictStringSchema,
      buttonColor: StrictStringSchema.optional(),
      buttonTextColor: StrictStringSchema.optional(),
      iconUrl: StrictStringSchema.optional(),
    }),
  ),
  loginSplash: t.looseObject({
    enabled: StrictBooleanSchema,
    blurPx: StrictFiniteNumberSchema,
    darkenOpacity: StrictFiniteNumberSchema,
  }),
  appearance: t.looseObject({ customCss: StrictStringSchema }).optional(),
})

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
    const result = PublicAuthConfigSchema.safeParse(await res.json())
    if (!result.success) {
      return { ok: false, error: "Not an Alloy server." }
    }
    // Capability version 1 predates the public appearance field. Keep that
    // protocol version compatible and supply the current empty CSS default.
    const body: PublicAuthConfig = {
      adminAccountRequired: result.data.adminAccountRequired,
      setupRequired: result.data.setupRequired,
      openRegistrations: result.data.openRegistrations,
      passkeyEnabled: result.data.passkeyEnabled,
      requireAuthToBrowse: result.data.requireAuthToBrowse,
      desktopAuth: result.data.desktopAuth,
      providers: result.data.providers,
      loginSplash: result.data.loginSplash,
      appearance: result.data.appearance ?? { customCss: "" },
    }
    if (!supportsDesktopAuth(body)) {
      return {
        ok: false,
        error: "This Alloy server does not support desktop login yet.",
      }
    }
    return { ok: true, serverUrl: baseUrl, config: body }
  } catch (cause) {
    const reason =
      cause instanceof Error && cause.name === "AbortError"
        ? translate(getRuntimeLocale(), "Connection timed out.")
        : translate(getRuntimeLocale(), "Could not reach server.")
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
    logger.warn(`probe failed for ${candidate}: ${result.error}`)
  }
  return { ok: false, error: lastError }
}
