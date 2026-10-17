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
