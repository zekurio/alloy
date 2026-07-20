const PAGE_HEAD_START_MARKER = "<!-- alloy:head:start -->"
const PAGE_HEAD_END_MARKER = "<!-- alloy:head:end -->"

/**
 * Replaces the app shell's generic metadata with route-specific metadata.
 * Keeping one complete metadata region prevents crawlers from choosing a
 * mixture of generic and clip-specific OpenGraph values.
 */
export function withPageHead(indexHtml: string, head: string): string {
  if (!head) return indexHtml

  const start = indexHtml.indexOf(PAGE_HEAD_START_MARKER)
  const end = indexHtml.indexOf(
    PAGE_HEAD_END_MARKER,
    start + PAGE_HEAD_START_MARKER.length,
  )
  if (start === -1 || end === -1) {
    throw new Error("web app shell is missing page head markers")
  }

  return `${indexHtml.slice(0, start + PAGE_HEAD_START_MARKER.length)}\n    ${head}\n    ${indexHtml.slice(end)}`
}
