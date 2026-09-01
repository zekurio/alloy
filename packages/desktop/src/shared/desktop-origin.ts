const SERVER_ORIGIN_ARGUMENT = "--alloy-server-origin="

/** Build the main-controlled command-line value read by the sandboxed preload. */
export function desktopOriginArgument(serverOrigin: string): string {
  const origin = normalizeDesktopOrigin(serverOrigin)
  if (!origin) throw new Error("Invalid desktop server origin")
  return `${SERVER_ORIGIN_ARGUMENT}${encodeURIComponent(origin)}`
}

/** Read the selected origin without exposing renderer-controlled configuration. */
export function desktopOriginFromArguments(
  args: readonly string[],
): string | null {
  const argument = args.find((value) =>
    value.startsWith(SERVER_ORIGIN_ARGUMENT),
  )
  if (!argument) return null
  try {
    return normalizeDesktopOrigin(
      decodeURIComponent(argument.slice(SERVER_ORIGIN_ARGUMENT.length)),
    )
  } catch {
    return null
  }
}

/** Exact-origin trust check shared by preload tests and the main process. */
export function isTrustedDesktopOrigin(
  rawUrl: string,
  expectedOrigin: string | null,
): boolean {
  if (!expectedOrigin) return false
  try {
    return new URL(rawUrl).origin === expectedOrigin
  } catch {
    return false
  }
}

function normalizeDesktopOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}
