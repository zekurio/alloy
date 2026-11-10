import { stableHash } from "@alloy/contracts"

const EMPTY_STATE_KAOMOJI = [
  "(◞‸◟；)",
  "( • ᴖ • ｡)",
  "( ;´ - `;)",
  "(｡•́︿•̀｡)",
  "(⊙_☉)",
  "(｡•́︵•̀｡)",
  "(；￣Д￣)",
] as const

const DEFAULT_EMPTY_STATE_KAOMOJI = "(◞‸◟；)"

/** The same seed always shows the same face. */
export function pickEmptyStateKaomoji(seed: string | number): string {
  return (
    EMPTY_STATE_KAOMOJI[stableHash(seed) % EMPTY_STATE_KAOMOJI.length] ??
    DEFAULT_EMPTY_STATE_KAOMOJI
  )
}
