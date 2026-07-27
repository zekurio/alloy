import type { IsoDateString, UserRole, UserStatus } from "./shared"

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
  email: string
  emailVerified: boolean
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
