/**
 * The bridge contract the desktop host implements and the server advertises
 * in `/api/server-info`. The host rejects a server that does not list this
 * ID, and the web app ignores a bridge that carries another one, so a
 * breaking change to `AlloyDesktop` takes the next number. This file imports
 * nothing, so the sandboxed desktop preload, bundled into a single file, can
 * import it without pulling in the bridge module's schemas.
 *
 * Keep `BRIDGE_CONTRACT` in `packages/desktop/host/src/server.rs` equal.
 */
export const DESKTOP_BRIDGE_CONTRACT = 2 as const
export const DESKTOP_BRIDGE_CONTRACT_IDS = [DESKTOP_BRIDGE_CONTRACT] as const
