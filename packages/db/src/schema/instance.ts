import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const instanceSetting = pgTable("instance_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type InstanceSetting = typeof instanceSetting.$inferSelect
