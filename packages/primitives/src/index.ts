/**
 * Declarations both contract surfaces depend on: the web/server contracts and
 * the desktop bridge contracts. Living here is what keeps
 * `@alloy/desktop-contracts` independent of `@alloy/contracts` and the other
 * way around, so this package stays dependency-free.
 */

export type IsoDateString = string

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

/**
 * The Tauri bridge contract the desktop host implements and the server
 * advertises in `/api/server-info`. The host rejects a server that does not
 * list this ID, so one declaration keeps the two sides in step.
 */
export const TAURI_DESKTOP_BRIDGE_CONTRACT_1 = 1 as const
export const TAURI_DESKTOP_BRIDGE_CONTRACT_IDS = Object.freeze([
  TAURI_DESKTOP_BRIDGE_CONTRACT_1,
] as const)
