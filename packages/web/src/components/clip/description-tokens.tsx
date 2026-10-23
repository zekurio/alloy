import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function renderHashtagTokens(raw: string): ReactNode[] {
  const pattern = /#([\p{L}\p{N}_]+)/gu
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(raw)) !== null) {
    const start = match.index
    const end = pattern.lastIndex
    if (start > lastIndex) nodes.push(raw.slice(lastIndex, start))
    const tag = match[1]
    if (!tag) continue
    nodes.push(
      <Link
        key={`tag-${key++}`}
        to="/tags/$tag"
        params={{ tag: tag.toLowerCase() }}
        className="text-accent hover:underline"
      >
        {"#"}
        {tag}
      </Link>,
    )
    lastIndex = end
  }
  if (lastIndex < raw.length) nodes.push(raw.slice(lastIndex))
  return nodes
}
