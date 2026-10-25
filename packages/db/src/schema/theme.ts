import type { UserThemeColors } from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"

// A user's own color themes. The client makes the ids, so they're only
// unique per user; the theme choice in user.theme_preferences refers to them.
export const userTheme = pgTable(
  "user_theme",
  {
    user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text().notNull(),
    name: text().notNull(),
    light: jsonb().$type<UserThemeColors>(),
    dark: jsonb().$type<UserThemeColors>(),
    guided: boolean().notNull().default(false),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.id] }),
    check(
      "user_theme_appearance_check",
      sql`${t.light} is not null or ${t.dark} is not null`,
    ),
  ],
)

export type UserThemeRow = typeof userTheme.$inferSelect
