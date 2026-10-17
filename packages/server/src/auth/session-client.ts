import type {
  AuthSessionBrowser,
  AuthSessionClientKind,
  AuthSessionOperatingSystem,
} from "@alloy/contracts"

export type SessionClientLabel = {
  browser: AuthSessionBrowser | null
  os: AuthSessionOperatingSystem | null
}

// Order matters: Edge and Opera also send `Chrome/`, Chrome also sends
// `Safari/`, and iOS and Android also name the desktop OS they imitate.
const BROWSER_PATTERNS: readonly [AuthSessionBrowser, RegExp][] = [
  ["Edge", /\bEdg(?:e|A|iOS)?\//],
  ["Opera", /\b(?:OPR|OPiOS)\/|\bOpera\b/],
  ["Firefox", /\b(?:Firefox|FxiOS)\//],
  ["Chrome", /\b(?:Chrome|CriOS)\//],
  ["Safari", /\bAppleWebKit\/.*\bSafari\//],
]

const OS_PATTERNS: readonly [AuthSessionOperatingSystem, RegExp][] = [
  ["iOS", /\b(?:iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMacintosh\b|\bMac OS X\b/],
  ["Linux", /\bLinux\b/],
]

// `std::env::consts::OS` values the desktop host reports in
// `Alloy-Desktop/<version> (<os>; <arch>)`.
const DESKTOP_OS: ReadonlyMap<string, AuthSessionOperatingSystem> = new Map([
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["linux", "Linux"],
])

const DESKTOP_USER_AGENT = /^Alloy-Desktop\/\S+ \(([a-z]+);/

function firstMatch<T>(
  patterns: readonly [T, RegExp][],
  userAgent: string,
): T | null {
  return patterns.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null
}

/**
 * Name the browser and OS behind a stored User-Agent for the session list.
 * Recognizes only the major families; anything else stays null rather than
 * guessing. Display only: never use the result for access decisions.
 */
export function sessionClientLabel(
  clientKind: AuthSessionClientKind,
  userAgent: string | null,
): SessionClientLabel {
  if (!userAgent) return { browser: null, os: null }
  if (clientKind === "desktop") {
    const os = DESKTOP_USER_AGENT.exec(userAgent)?.[1]
    return { browser: null, os: (os && DESKTOP_OS.get(os)) || null }
  }
  return {
    browser: firstMatch(BROWSER_PATTERNS, userAgent),
    os: firstMatch(OS_PATTERNS, userAgent),
  }
}
