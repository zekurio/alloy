import { clientLogger } from "./client-log"

interface ProfilePath {
  username: string
  segment: string | null
}

const warnedMalformedSegments = new Set<string>()

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch (cause) {
    if (!warnedMalformedSegments.has(segment)) {
      warnedMalformedSegments.add(segment)
      clientLogger.warn(
        "[routing] Failed to decode profile path segment.",
        cause
      )
    }
    return segment
  }
}

export function parseProfilePathname(pathname: string): ProfilePath | null {
  const match = /^\/u\/([^/]+)(?:\/([^/]+))?/.exec(pathname)
  const username = match?.[1]
  if (!username) return null
  return {
    username: decodePathSegment(username),
    segment: match[2] ? decodePathSegment(match[2]) : null,
  }
}
