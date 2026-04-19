import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

// Tables consumed by better-auth's drizzle adapter. All ids and FKs are real
// pg `uuid` columns — `auth.ts` sets `advanced.database.generateId: "uuid"`
// so better-auth mints UUIDs for every row. Re-generate with
// `npx @better-auth/cli generate` if you add plugins that extend these.
//
// There is no separate `name` column: better-auth's required `name` field is
// mapped onto `username` via `user.fields` in `auth.ts`, so the app has a
// single handle per user. The `role`/`banned`/`banReason`/`banExpires` user
// columns and `impersonated_by` session column come from the `admin` plugin.

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Single canonical handle, written via better-auth's `name` field (mapped
  // through `user.fields.name = "username"`). Populated for every user by the
  // `create.before` hook; DB-enforced unique.
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
})

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: uuid("impersonated_by"),
})

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})
