import {
  SyncedThemePreferencesSchema,
  type AuthSessionSummary,
  type AuthUser,
  type LinkedAccount,
  type Passkey,
  type SessionData,
} from "@alloy/contracts"
import type { AuthSession, User } from "@alloy/db/auth-schema"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"

import { sessionClientLabel } from "./session-client"

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
  accountLabel: string | null
  createdAt: Date
}

type PublicSessionData = {
  session: AuthSession
  user: User
}

export function publicAuthUserRow(row: User): AuthUser {
  // Return type is annotated deliberately: the client validates this payload
  // with a runtime cast, so without it a missing field compiles clean and only
  // shows up as a silently-undefined value in the UI.
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    image: row.image,
    banner: row.banner,
    role: row.role,
    status: row.status,
    disabledAt: nullableIsoDate(row.disabled_at),
    storageQuotaBytes: row.storage_quota_bytes,
    clipAnnouncementsEnabled: row.clip_announcements_enabled,
    themePreferences: publicThemePreferences(row.theme_preferences),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

/**
 * The stored theme as the client may read it. A row written before the theme
 * id format tightened (or edited by hand) reads as "none saved" rather than
 * breaking every session response.
 */
function publicThemePreferences(
  value: User["theme_preferences"],
): AuthUser["themePreferences"] {
  const parsed = SyncedThemePreferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function publicAuthSessionRow(row: AuthSession): SessionData["session"] {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: nullableIsoDate(row.expires_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    lastSeenAt: nullableIsoDate(row.last_seen_at),
  }
}

export function publicSessionData(row: PublicSessionData): SessionData {
  return {
    session: publicAuthSessionRow(row.session),
    user: publicAuthUserRow(row.user),
  }
}

export function publicAuthSessionSummary(
  row: AuthSession,
  currentId: string,
): AuthSessionSummary {
  // Annotated for the same reason as publicAuthUserRow. Leave out token_hash,
  // user_id, and the raw user_agent.
  const { browser, os } = sessionClientLabel(row.client_kind, row.user_agent)
  return {
    id: row.id,
    current: row.id === currentId,
    clientKind: row.client_kind,
    deviceName: row.device_name,
    browser,
    os,
    ipAddress: row.ip_address,
    createdAt: isoDate(row.created_at),
    lastSeenAt: isoDate(row.last_seen_at ?? row.created_at),
    expiresAt: isoDate(row.expires_at),
  }
}

export function publicPasskeyRow(row: PublicPasskeyRow): Passkey {
  return {
    id: row.id,
    name: row.name,
    createdAt: isoDate("createdAt" in row ? row.createdAt : row.created_at),
    deviceType: "deviceType" in row ? row.deviceType : row.device_type,
  }
}

export function publicLinkedAccountRow(
  row: PublicLinkedAccountRow,
): LinkedAccount {
  return {
    id: row.id,
    providerId: row.providerId,
    accountId: row.accountId,
    accountLabel: row.accountLabel,
    createdAt: isoDate(row.createdAt),
  }
}
