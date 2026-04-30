export const EMPTY_STATE_KAOMOJI = [
  "(◞‸◟；)",
  "( • ᴖ • ｡)",
  "( ;´ - `;)",
  "(｡•́︿•̀｡)",
  "(⊙_☉)",
  "(｡•́︵•̀｡)",
  "(；￣Д￣)",
] as const

let rotation: number[] = []
let lastPickedIndex: number | undefined

function hashSeed(seed: string | number): number {
  const s = typeof seed === "number" ? String(seed) : seed
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

function shuffleIndices(): number[] {
  const indices = Array.from(EMPTY_STATE_KAOMOJI, (_, index) => index)

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = indices[i]!
    indices[i] = indices[j]!
    indices[j] = tmp
  }

  if (
    lastPickedIndex !== undefined &&
    indices.length > 1 &&
    indices[0] === lastPickedIndex
  ) {
    const swapIndex = indices.findIndex((index) => index !== lastPickedIndex)
    const tmp = indices[0]!
    indices[0] = indices[swapIndex]!
    indices[swapIndex] = tmp
  }

  return indices
}

export function pickEmptyStateKaomoji(seed?: string | number): string {
  if (seed !== undefined) {
    return EMPTY_STATE_KAOMOJI[hashSeed(seed) % EMPTY_STATE_KAOMOJI.length]!
  }

  if (rotation.length === 0) {
    rotation = shuffleIndices()
  }

  const index = rotation.shift()!
  lastPickedIndex = index

  return EMPTY_STATE_KAOMOJI[index]!
}
