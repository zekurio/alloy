import {
  DESKTOP_BRIDGE_CONTRACT_1,
  DESKTOP_HTTP_CONTRACT_1,
  ServerInfoSchema,
} from "@alloy/contracts"

import type { UntrustedInput } from "./runtime-validation"

export type ServerHttpContractResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * A remote renderer must advertise both the immutable HTTP contract and the
 * native bridge contract expected by this desktop release.
 */
export function evaluateServerInfoResponse(
  status: number,
  body: UntrustedInput,
): ServerHttpContractResult {
  if (status === 404) {
    return {
      ok: false,
      error: "Update this Alloy server before connecting this desktop app.",
    }
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      error: `Server contract check responded with ${status}.`,
    }
  }

  const parsed = ServerInfoSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: "Invalid Alloy server contract response." }
  }
  if (!parsed.data.httpContracts.includes(DESKTOP_HTTP_CONTRACT_1)) {
    return {
      ok: false,
      error: "This Alloy server is not compatible with this desktop app.",
    }
  }
  if (
    !parsed.data.desktopBridgeContracts?.includes(DESKTOP_BRIDGE_CONTRACT_1)
  ) {
    return {
      ok: false,
      error: "This Alloy server does not provide a compatible desktop UI.",
    }
  }
  return { ok: true }
}
