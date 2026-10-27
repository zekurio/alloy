/**
 * The bridge contract the desktop host implements and the server advertises
 * in `/api/server-info`. The host rejects a server that does not list this
 * ID, so one declaration keeps the two sides in step. It lives outside
 * `@alloy/contracts` so the sandboxed desktop preload, bundled into a single
 * file, can import it without pulling in the bridge module's schemas.
 */
export const DESKTOP_BRIDGE_CONTRACT_1 = 1 as const
export const DESKTOP_BRIDGE_CONTRACT_IDS = Object.freeze([
  DESKTOP_BRIDGE_CONTRACT_1,
] as const)
