import { stableHash } from "alloy-ui/lib/stable-hash"

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

let rotation: number[] = []
let lastPickedIndex: number | undefined

function shuffleIndices(): number[] {
  const indices = Array.from(EMPTY_STATE_KAOMOJI, (_, index) => index)

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = indices[i]
    const swap = indices[j]
    if (tmp === undefined || swap === undefined) continue
    indices[i] = swap
    indices[j] = tmp
  }

  if (
    lastPickedIndex !== undefined &&
    indices.length > 1 &&
    indices[0] === lastPickedIndex
  ) {
    const swapIndex = indices.findIndex((index) => index !== lastPickedIndex)
    const first = indices[0]
    const swap = indices[swapIndex]
    if (first === undefined || swap === undefined) return indices
    indices[0] = swap
    indices[swapIndex] = first
  }

  return indices
}

export function pickEmptyStateKaomoji(seed?: string | number): string {
  if (seed !== undefined) {
    return (
      EMPTY_STATE_KAOMOJI[stableHash(seed) % EMPTY_STATE_KAOMOJI.length] ??
      DEFAULT_EMPTY_STATE_KAOMOJI
    )
  }

  if (rotation.length === 0) {
    rotation = shuffleIndices()
  }

  const index = rotation.shift()
  if (index === undefined) return DEFAULT_EMPTY_STATE_KAOMOJI
  lastPickedIndex = index

  return EMPTY_STATE_KAOMOJI[index] ?? DEFAULT_EMPTY_STATE_KAOMOJI
}
