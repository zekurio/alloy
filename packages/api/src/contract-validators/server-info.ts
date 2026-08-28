import { ServerInfoSchema, type ServerInfo } from "@alloy/contracts"

import type { ApiJsonInput } from "../json-value"

/** Validate the public `/api/server-info` response at runtime. */
export function validateServerInfo(value: ApiJsonInput): ServerInfo {
  return ServerInfoSchema.parse(value)
}
