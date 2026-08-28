import { DESKTOP_HTTP_CONTRACT_1, ServerInfoSchema } from "@alloy/contracts"

import type { UntrustedInput } from "./runtime-validation"

export type ServerHttpContractResult =
  | { ok: true; implicitContract1: boolean }
  | { ok: false; error: string }

/**
 * Servers released before `/api/server-info` are the initial HTTP contract.
 * Once the endpoint exists, its validated list must contain exact contract 1.
 */
export function evaluateServerInfoResponse(
  status: number,
  body: UntrustedInput,
): ServerHttpContractResult {
  if (status === 404) return { ok: true, implicitContract1: true }
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
  return { ok: true, implicitContract1: false }
}
