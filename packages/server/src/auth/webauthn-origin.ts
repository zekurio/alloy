import { isLoopbackHostname, normalizeOrigin } from "@alloy/env"

export type WebAuthnChallengeContext = {
  origin: string
  rpId: string
}

export function webAuthnChallengeContext(input: {
  publicServerUrl: string
  requestOrigin?: string
  trustedOrigins: string[]
}): WebAuthnChallengeContext {
  const publicOrigin = normalizeOrigin(input.publicServerUrl)
  const origin =
    trustedRequestOrigin(input.requestOrigin, input.trustedOrigins) ??
    publicOrigin

  return {
    origin,
    rpId: webAuthnRpIdForOrigin(input.publicServerUrl, origin),
  }
}

export function webAuthnRpIdForOrigin(
  publicServerUrl: string,
  origin: string,
): string {
  const publicRpId = new URL(publicServerUrl).hostname
  const originHostname = new URL(origin).hostname

  if (canUseRpIdWithOrigin(publicRpId, originHostname)) return publicRpId
  return originHostname
}

function trustedRequestOrigin(
  rawOrigin: string | undefined,
  trustedOrigins: string[],
): string | null {
  if (!rawOrigin || !URL.canParse(rawOrigin)) return null

  const origin = normalizeOrigin(rawOrigin)
  return trustedOrigins.includes(origin) ? origin : null
}

function canUseRpIdWithOrigin(rpId: string, originHostname: string): boolean {
  const candidate = rpId.toLowerCase()
  const hostname = originHostname.toLowerCase()

  if (candidate === hostname) return true
  if (isSpecialHostname(candidate) || isSpecialHostname(hostname)) return false
  return hostname.endsWith(`.${candidate}`)
}

function isSpecialHostname(hostname: string): boolean {
  return isLoopbackHostname(hostname) || isIpHostname(hostname)
}

function isIpHostname(hostname: string): boolean {
  return isIpv4Hostname(hostname) || hostname.includes(":")
}

function isIpv4Hostname(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false

    const value = Number(part)
    return value >= 0 && value <= 255
  })
}
