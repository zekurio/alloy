import { createHash } from "node:crypto"

/** Whether `url` belongs to `origin` (`scheme://host[:port]`). */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** The path of `url`, or null when it does not parse. */
export function urlPath(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/**
 * Whether a link the shell will not open itself may go to the user's
 * browser. Only `http` and `https` are forwarded, so a page cannot launch
 * another handler.
 */
export function isExternalWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

/**
 * Each server gets its own persistent Chromium profile, so forgetting one
 * server clears its cookies and storage without touching another's.
 */
export function serverPartition(origin: string): string {
  const hash = createHash("sha256").update(origin).digest("hex")
  return `persist:server-${hash}`
}
