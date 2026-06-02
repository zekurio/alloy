export function stableHash(seed: string | number): number {
  const value = String(seed)
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function stableHue(seed: string | number): number {
  return stableHash(seed) % 360
}
