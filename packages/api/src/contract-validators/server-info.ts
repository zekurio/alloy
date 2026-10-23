import {
  type ContractJsonInput,
  type ServerInfo,
  ServerInfoSchema,
} from "@alloy/contracts"

/** Validate the public `/api/server-info` response at runtime. */
export function validateServerInfo(value: ContractJsonInput): ServerInfo {
  return ServerInfoSchema.parse(value)
}
