import { t } from "@alloy/contracts/schema"

export type DesktopAuthorizeSearch = {
  redirect_uri?: string
  state?: string
  code_challenge?: string
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

const CodeChallengeSchema = t.string().min(32).max(128).regex(BASE64URL_RE)

function isLoopbackRedirectUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

function isCodeChallenge(value: string): boolean {
  return CodeChallengeSchema.safeParse(value).success
}

/**
 * Whether the parsed search carries a complete desktop handshake: a loopback
 * redirect target plus the state and PKCE challenge the authorize POST
 * requires before minting a code.
 */
export function isDesktopAuthorizeSearch(
  search: DesktopAuthorizeSearch,
): search is Required<DesktopAuthorizeSearch> {
  return (
    search.redirect_uri !== undefined &&
    isLoopbackRedirectUri(search.redirect_uri) &&
    search.state !== undefined &&
    search.code_challenge !== undefined &&
    isCodeChallenge(search.code_challenge)
  )
}
