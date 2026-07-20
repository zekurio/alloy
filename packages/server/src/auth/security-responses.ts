import type { AuthSession, User } from "@alloy/db/auth-schema"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"

type PublicPasskeyRow = {
  id: string
  name: string | null
} & (
  | { createdAt: Date; deviceType: string }
  | { created_at: Date; device_type: string }
)

type PublicLinkedAccountRow = {
  id: string
  providerId: string
  accountId: string
  email: string | null
  createdAt: Date
}

type PublicSessionData = {
  session: AuthSession
  user: User
}

export function publicAuthUserRow(row: User) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    username: row.username,
    displayName: row.display_name,
    image: row.image,
    banner: row.banner,
    role: row.role,
    status: row.status,
    disabledAt: nullableIsoDate(row.disabled_at),
    storageQuotaBytes: row.storage_quota_bytes,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

export function publicAuthSessionRow(row: AuthSession) {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: nullableIsoDate(row.expires_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    lastSeenAt: nullableIsoDate(row.last_seen_at),
  }
}

export function publicSessionData(row: PublicSessionData) {
  return {
    session: publicAuthSessionRow(row.session),
    user: publicAuthUserRow(row.user),
  }
}

export function publicPasskeyRow(row: PublicPasskeyRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: isoDate("createdAt" in row ? row.createdAt : row.created_at),
    deviceType: "deviceType" in row ? row.deviceType : row.device_type,
  }
}

export function publicLinkedAccountRow(row: PublicLinkedAccountRow) {
  return {
    id: row.id,
    providerId: row.providerId,
    accountId: row.accountId,
    email: row.email,
    createdAt: isoDate(row.createdAt),
  }
}
