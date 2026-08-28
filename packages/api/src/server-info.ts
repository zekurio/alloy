import type { ServerInfo } from "@alloy/contracts"

import type { ApiContext } from "./client"
import { validateServerInfo } from "./contract-validators/server-info"
import { readJsonOrThrow } from "./http"

export type ServerInfoApiContext = Pick<ApiContext, "request">

export const SERVER_INFO_PATH = "/api/server-info" as const

export type { ServerInfo } from "@alloy/contracts"

/** Fetch and validate the public server capability declaration. */
export async function fetchServerInfo(
  context: ServerInfoApiContext,
): Promise<ServerInfo> {
  // Use the low-level request seam rather than treating the generated Hono
  // client type as the trust boundary. The response is still untrusted JSON.
  const res = await context.request(SERVER_INFO_PATH)
  return readJsonOrThrow(res, validateServerInfo)
}

export function createServerInfoApi(context: ServerInfoApiContext) {
  return {
    fetch: () => fetchServerInfo(context),
  }
}
