import type { UploadLimits } from "./upload-limits"

/** Marks the document as Alloy's, so the desktop rejects another service. */
export const SERVER_INFO_PRODUCT = "alloy" as const

/**
 * The only desktop HTTP contract the web app and the desktop host know.
 *
 * Alloy currently has one operator and no external deployments. Contract 1
 * can change with a coordinated desktop and server update. Version breaking
 * changes once independently deployed clients need a support window.
 */
const DESKTOP_HTTP_CONTRACT_1 = 1 as const
export const DESKTOP_HTTP_CONTRACT_IDS = [DESKTOP_HTTP_CONTRACT_1] as const

/**
 * The public `/api/server-info` document. The desktop host connects only to
 * a server that lists the HTTP and bridge contract it was built for.
 */
export interface ServerInfo {
  product: typeof SERVER_INFO_PRODUCT
  /** Informational application SemVer. Compatibility never uses this value. */
  version: string
  httpContracts: number[]
  /**
   * Desktop bridge contracts (`window.alloyDesktop`) understood by the
   * server-hosted web app.
   */
  desktopBridgeContracts: number[]
  uploadLimits: UploadLimits
}
