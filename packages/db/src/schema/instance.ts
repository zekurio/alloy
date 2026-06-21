import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const instanceSetting = pgTable("instance_setting", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updated_at: timestamp().notNull().defaultNow(),
})

export type InstanceSetting = typeof instanceSetting.$inferSelect
