import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"
import { game } from "./game"

/**
 * A desktop install that uploads clips on behalf of a user. The id is
 * client-generated and persisted on the device, so re-registration after a
 * reinstall keeps the same identity. Web uploads have no device.
 */
export const userDevice = pgTable(
  "user_device",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("user_device_user_idx").on(t.userId)],
)

/**
 * A single play of a game on one device, as observed by the desktop game
 * detector. The raw detected name is the ground truth; steamgriddbId is a
 * best-effort server-side resolution and may stay null.
 */
export const gameSession = pgTable(
  "game_session",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => userDevice.id, { onDelete: "cascade" }),
    gameName: text("game_name").notNull(),
    steamgriddbId: integer("steamgriddb_id").references(
      () => game.steamgriddbId,
      { onDelete: "set null" },
    ),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("game_session_user_started_idx").on(t.userId, t.startedAt)],
)

export type UserDevice = typeof userDevice.$inferSelect
export type GameSession = typeof gameSession.$inferSelect
