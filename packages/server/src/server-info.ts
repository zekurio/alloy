import {
  DESKTOP_HTTP_CAPABILITIES,
  DESKTOP_HTTP_CONTRACT_IDS,
  SERVER_INFO_PRODUCT,
  SERVER_INFO_SCHEMA,
  type ServerInfo,
} from "@alloy/contracts"

import packageJson from "../../../package.json" with { type: "json" }

/**
 * Public, unauthenticated server metadata for the bundled desktop renderer.
 * The application version is useful for diagnostics only. Contract selection
 * is driven by the exact desktop HTTP declarations below.
 */
export function buildServerInfo(): ServerInfo {
  return {
    schema: SERVER_INFO_SCHEMA,
    product: SERVER_INFO_PRODUCT,
    version: packageJson.version,
    // Copy the policy array so callers cannot mutate the shared declaration.
    httpContracts: [...DESKTOP_HTTP_CONTRACT_IDS],
    capabilities: {
      auth: { ...DESKTOP_HTTP_CAPABILITIES.auth },
      transport: { ...DESKTOP_HTTP_CAPABILITIES.transport },
    },
  }
}
