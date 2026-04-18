import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { user } from "./auth-schema"

// Domain tables live here. Better-auth tables are in `./auth-schema` and are
// picked up by drizzle-kit via `../drizzle.config.ts`.
//
// Auth configuration (OAuth providers, email/password toggle) is no longer
// stored in the database — it's driven by env vars and a JSON-backed runtime
// config file. See apps/server/src/env.ts and apps/server/src/lib/config-store.ts.

export const clip = pgTable("clip", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  game: text("game"),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type Clip = typeof clip.$inferSelect
export type NewClip = typeof clip.$inferInsert

export { user, session, account, verification } from "./auth-schema"
