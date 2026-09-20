export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function withInjectedHead(indexHtml: string, head: string): string {
  if (!head) return indexHtml
  // Clip metadata replaces the defaults so crawlers never see conflicting tags.
  return indexHtml.replace(
    /<!-- alloy:head -->[\s\S]*?<!-- \/alloy:head -->/,
    () => head,
  )
}
