import type { ServerInfo } from "@alloy/contracts"

import type { ApiContext } from "./client"
import { readJsonOrThrow } from "./http"

export type { ServerInfo } from "@alloy/contracts"

export function createServerInfoApi(context: ApiContext) {
  return {
    async fetch(): Promise<ServerInfo> {
      const res = await context.rpc.api["server-info"].$get()
      return readJsonOrThrow(res)
    },
  }
}
