import {
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { sqlStringList } from "./internal"

export { USER_ROLES, USER_STATUSES }

export const user = pgTable(
  "user",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull().unique(),
    email_verified: boolean().notNull().default(false),
    username: text().notNull(),
    image: text(),
    banner: text(),
    role: text().$type<UserRole>().notNull().default("user"),
    status: text().$type<UserStatus>().notNull().default("active"),
    disabled_at: timestamp(),
    storage_quota_bytes: bigint({ mode: "number" }),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_username_lower_unique").on(sql`lower(${t.username})`),
    check(
      "user_role_check",
      sql`${t.role} in (${sql.raw(sqlStringList(USER_ROLES))})`,
    ),
    check(
      "user_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(USER_STATUSES))})`,
    ),
    check(
      "user_storage_quota_bytes_safe_check",
      sql`${t.storage_quota_bytes} is null or (${t.storage_quota_bytes} > 0 and ${t.storage_quota_bytes} <= 9007199254740991)`,
    ),
  ],
)

export const authSession = pgTable("auth_session", {
  id: uuid().primaryKey().defaultRandom(),
  token_hash: text().notNull().unique(),
  user_id: uuid()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires_at: timestamp(),
  ip_address: text(),
  user_agent: text(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
  last_seen_at: timestamp(),
  revoked_at: timestamp(),
})

export const authRefreshToken = pgTable(
  "auth_refresh_token",
  {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid()
      .notNull()
      .references(() => authSession.id, { onDelete: "cascade" }),
    token_hash: text().notNull().unique(),
    expires_at: timestamp().notNull(),
    absolute_expires_at: timestamp().notNull(),
    consumed_at: timestamp(),
    revoked_at: timestamp(),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
    last_used_at: timestamp(),
  },
  (t) => [
    index("auth_refresh_token_session_idx").on(t.session_id),
    index("auth_refresh_token_expires_at_idx").on(t.expires_at),
  ],
)

export const userPasskey = pgTable("user_passkey", {
  id: uuid().primaryKey().defaultRandom(),
  user_id: uuid()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credential_id: text().notNull().unique(),
  public_key: text().notNull(),
  counter: integer().notNull().default(0),
  name: text(),
  device_type: text().notNull(),
  backed_up: boolean().notNull().default(false),
  transports: text(),
  aaguid: text(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
  last_used_at: timestamp(),
})

export const authAccount = pgTable(
  "auth_account",
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    provider_account_id: text().notNull(),
    email: text(),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    access_token_expires_at: timestamp(),
    refresh_token_expires_at: timestamp(),
    scope: text(),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_account_provider_account_idx").on(
      t.provider_id,
      t.provider_account_id,
    ),
  ],
)

export const authChallenge = pgTable(
  "auth_challenge",
  {
    id: uuid().primaryKey().defaultRandom(),
    purpose: text().notNull(),
    identifier: text().notNull(),
    challenge: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    expires_at: timestamp().notNull(),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    // High-churn table swept by `expires_at`; without this the TTL cleanup is a
    // sequential scan on every passkey challenge create.
    index("auth_challenge_expires_at_idx").on(t.expires_at),
    // Consume paths (OAuth state, desktop link codes) look up by
    // (purpose, identifier).
    index("auth_challenge_purpose_identifier_idx").on(t.purpose, t.identifier),
  ],
)

export const authSchema = {
  user,
  authSession,
  authRefreshToken,
  userPasskey,
  authAccount,
  authChallenge,
} as const

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type AuthSession = typeof authSession.$inferSelect
export type AuthRefreshToken = typeof authRefreshToken.$inferSelect
export type UserPasskey = typeof userPasskey.$inferSelect
