import type { IsoDateString, UserRole, UserStatus } from "./shared"

export const AUTH_ERROR_CODES = {
  accountReactivationRequired: "account_reactivation_required",
  accountBanned: "account_banned",
} as const
export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES]

/**
 * How a session was created: a browser sign-in, or the desktop app's code
 * exchange. Set by the endpoint that creates the session, never derived from
 * the client's User-Agent.
 */
export const AUTH_SESSION_CLIENT_KINDS = ["web", "desktop"] as const
export type AuthSessionClientKind = (typeof AUTH_SESSION_CLIENT_KINDS)[number]

/** Browser families the server recognizes in a session's User-Agent. */
export const AUTH_SESSION_BROWSERS = [
  "Firefox",
  "Chrome",
  "Edge",
  "Safari",
  "Opera",
] as const
export type AuthSessionBrowser = (typeof AUTH_SESSION_BROWSERS)[number]

/** Operating systems the server recognizes in a session's User-Agent. */
export const AUTH_SESSION_OPERATING_SYSTEMS = [
  "Windows",
  "macOS",
  "Linux",
  "Android",
  "iOS",
  "ChromeOS",
] as const
export type AuthSessionOperatingSystem =
  (typeof AUTH_SESSION_OPERATING_SYSTEMS)[number]

/**
 * One of the signed-in user's sessions, as listed in their settings. The
 * token hash, owner, and raw User-Agent stay on the server; `browser` and `os`
 * are parsed from the User-Agent when the list is read.
 */
export interface AuthSessionSummary {
  id: string
  /** The session that made this request. */
  current: boolean
  clientKind: AuthSessionClientKind
  /** Computer name reported by the desktop app. Null for browsers. */
  deviceName: string | null
  browser: AuthSessionBrowser | null
  os: AuthSessionOperatingSystem | null
  /** Address of the last request that moved the session's idle deadline. */
  ipAddress: string | null
  createdAt: IsoDateString
  lastSeenAt: IsoDateString
  expiresAt: IsoDateString
}

/**
 * The authenticated user as it crosses the wire.
 *
 * Shared rather than duplicated because the client validates this shape with a
 * runtime cast: if the server's serialiser and the client's type drift, nothing
 * fails to compile and the field simply arrives undefined. Annotating the
 * server's builder with this type is what makes the seam compile-checked.
 */
export interface AuthUser {
  id: string
  username: string
  displayName: string | null
  image: string | null
  banner: string | null
  role: UserRole
  status: UserStatus
  disabledAt: IsoDateString | null
  storageQuotaBytes: number | null
  clipAnnouncementsEnabled: boolean
  createdAt: IsoDateString
  updatedAt: IsoDateString
}
