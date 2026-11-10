import {
  DESKTOP_BRIDGE_CONTRACT_IDS,
  DESKTOP_HTTP_CONTRACT_IDS,
  SERVER_INFO_PRODUCT,
  type ServerInfo,
} from "@alloy/contracts"

import packageJson from "../../../package.json" with { type: "json" }
import { configStore } from "./config/store"

/**
 * Public, unauthenticated server metadata for desktop compatibility.
 * The application version is useful for diagnostics only. The desktop host
 * decides compatibility from the two contract lists.
 */
export function buildServerInfo(): ServerInfo {
  return {
    product: SERVER_INFO_PRODUCT,
    version: packageJson.version,
    httpContracts: [...DESKTOP_HTTP_CONTRACT_IDS],
    desktopBridgeContracts: [...DESKTOP_BRIDGE_CONTRACT_IDS],
    uploadLimits: configStore.get("uploadLimits"),
  }
}
