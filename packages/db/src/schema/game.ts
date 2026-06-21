import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "./auth"

export const game = pgTable(
  "game",
  {
    // SteamGridDB is the canonical game identity. This table is a durable
    // metadata cache, not a second identity namespace.
    steamgriddb_id: integer().primaryKey(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    release_date: timestamp(),
    hero_url: text(),
    hero_blur_hash: text(),
    grid_url: text(),
    grid_blur_hash: text(),
    logo_url: text(),
    icon_url: text(),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [index("game_name_idx").on(t.name)],
)

export const gameFollow = pgTable(
  "game_follow",
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    steamgriddb_id: integer()
      .notNull()
      .references(() => game.steamgriddb_id, { onDelete: "cascade" }),
    created_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_follow_pair_idx").on(t.user_id, t.steamgriddb_id),
    // Reverse lookup for the feed-ranking join ("is this clip's game
    // followed by the viewer?"), and for per-game follower counts.
    index("game_follow_steamgriddb_idx").on(t.steamgriddb_id),
  ],
)

export const gameDetectionMapping = pgTable(
  "game_detection_mapping",
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().notNull(),
    source_id: text(),
    executable: text(),
    normalized_name: text().notNull(),
    steamgriddb_id: integer().references(() => game.steamgriddb_id, {
      onDelete: "set null",
    }),
    status: text().$type<"auto" | "confirmed" | "rejected">().notNull(),
    confidence: real().notNull().default(0),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index("game_detection_mapping_source_idx").on(t.source, t.source_id),
    index("game_detection_mapping_executable_idx").on(t.executable),
    index("game_detection_mapping_name_idx").on(t.normalized_name),
    index("game_detection_mapping_steamgriddb_idx").on(t.steamgriddb_id),
  ],
)
