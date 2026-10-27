/**
 * Dependency-free declarations shared by the web/server contracts and the
 * desktop bridge contracts in `@alloy/contracts`.
 */

export type IsoDateString = string

export const CLIP_PRIVACY = ["public", "unlisted", "private"] as const
export type ClipPrivacy = (typeof CLIP_PRIVACY)[number]

/**
 * The bridge contract the desktop host implements and the server advertises
 * in `/api/server-info`. The host rejects a server that does not list this
 * ID, so one declaration keeps the two sides in step.
 */
export const DESKTOP_BRIDGE_CONTRACT_1 = 1 as const
export const DESKTOP_BRIDGE_CONTRACT_IDS = Object.freeze([
  DESKTOP_BRIDGE_CONTRACT_1,
] as const)
