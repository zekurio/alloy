/** The canonical public link for a clip. */
export function clipShareUrl(clipId: string, origin: string): string {
  return new URL(`/clips/${encodeURIComponent(clipId)}`, origin).toString()
}
