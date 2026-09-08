/** A public clip link; a fresh timestamp asks preview caches to fetch again. */
export function clipShareUrl(
  clipId: string,
  origin: string,
  timestamp?: number,
): string {
  const url = new URL(`/clips/${encodeURIComponent(clipId)}`, origin)
  if (timestamp !== undefined) url.searchParams.set("t", String(timestamp))
  return url.toString()
}
