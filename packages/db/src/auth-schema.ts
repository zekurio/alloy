import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const USER_ROLES = ["user", "admin"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ["active", "disabled"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  username: text("username").notNull().unique(),
  displayUsername: text("display_username").notNull().default(""),
  name: text("name").notNull().default(""),
  image: text("image"),
  banner: text("banner"),
  role: text("role").$type<UserRole>().notNull().default("user"),
  status: text("status").$type<UserStatus>().notNull().default("active"),
  disabledAt: timestamp("disabled_at"),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

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
      t.providerAccountId
    ),
  ]
)

export const authChallenge = pgTable("auth_challenge", {
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
})

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
export type NewAuthSession = typeof authSession.$inferInsert
export type UserPasskey = typeof userPasskey.$inferSelect
export type NewUserPasskey = typeof userPasskey.$inferInsert
export type AuthAccount = typeof authAccount.$inferSelect
export type NewAuthAccount = typeof authAccount.$inferInsert
export type AuthChallenge = typeof authChallenge.$inferSelect
export type NewAuthChallenge = typeof authChallenge.$inferInsert
