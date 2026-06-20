const BLURHASH_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"

const BLURHASH_ALPHABET_SET = new Set(BLURHASH_ALPHABET)

export const BLURHASH_MIN_LENGTH = 6
export const BLURHASH_MAX_LENGTH = 166

export function isBlurHash(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (
    value.length < BLURHASH_MIN_LENGTH ||
    value.length > BLURHASH_MAX_LENGTH
  ) {
    return false
  }
  for (const char of value) {
    if (!BLURHASH_ALPHABET_SET.has(char)) return false
  }
  return value.length === expectedBlurHashLength(value)
}

export function normalizeBlurHash(value: string | null): string | null {
  return isBlurHash(value) ? value : null
}

export function blurHashComponents(
  width: number,
  height: number,
): { x: number; y: number } {
  if (width <= 0 || height <= 0) return { x: 1, y: 1 }
  const xCompF = Math.sqrt((16 * width) / height)
  const yCompF = (xCompF * height) / width
  return {
    x: clampComponent(Math.floor(xCompF) + 1),
    y: clampComponent(Math.floor(yCompF) + 1),
  }
}

function expectedBlurHashLength(hash: string): number {
  const sizeFlag = BLURHASH_ALPHABET.indexOf(hash[0])
  if (sizeFlag < 0) return -1
  const componentsX = (sizeFlag % 9) + 1
  const componentsY = Math.floor(sizeFlag / 9) + 1
  return 4 + 2 * componentsX * componentsY
}

function clampComponent(value: number): number {
  return Math.max(1, Math.min(9, value))
}
