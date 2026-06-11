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
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    username: text("username").notNull(),
    displayUsername: text("display_username").notNull().default(""),
    image: text("image"),
    banner: text("banner"),
    background: text("background"),
    accentColor: text("accent_color"),
    role: text("role").$type<UserRole>().notNull().default("user"),
    status: text("status").$type<UserStatus>().notNull().default("active"),
    disabledAt: timestamp("disabled_at"),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
      sql`${t.storageQuotaBytes} is null or (${t.storageQuotaBytes} > 0 and ${t.storageQuotaBytes} <= 9007199254740991)`,
    ),
  ],
)

export const authSession = pgTable("auth_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
})

export const userPasskey = pgTable("user_passkey", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  name: text("name"),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
})

export const authAccount = pgTable(
  "auth_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_account_provider_account_idx").on(
      t.providerId,
      t.providerAccountId,
    ),
  ],
)

export const authChallenge = pgTable(
  "auth_challenge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    identifier: text("identifier").notNull(),
    challenge: text("challenge").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // High-churn table swept by `expires_at`; without this the TTL cleanup is a
    // sequential scan on every passkey challenge create.
    index("auth_challenge_expires_at_idx").on(t.expiresAt),
    // Consume paths (OAuth state, desktop link codes) look up by
    // (purpose, identifier).
    index("auth_challenge_purpose_identifier_idx").on(t.purpose, t.identifier),
  ],
)

export const authSchema = {
  user,
  authSession,
  userPasskey,
  authAccount,
  authChallenge,
} as const

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type AuthSession = typeof authSession.$inferSelect
export type UserPasskey = typeof userPasskey.$inferSelect
