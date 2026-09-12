import { GAME_SOURCE, type GameSource } from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { sqlStringList } from "./internal"

export const game = pgTable(
  "game",
  {
    // Surrogate identity. SteamGridDB games carry their `steamgriddb_id`
    // (unique, durable metadata cache); custom games are admin-authored and
    // leave it null. All references point at this id, not the SteamGridDB id.
    id: uuid().primaryKey().defaultRandom(),
    steamgriddb_id: integer().unique(),
    source: text().$type<GameSource>().notNull().default("steamgriddb"),
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
  (t) => [
    index("game_name_idx").on(t.name),
    check(
      "game_source_check",
      sql`${t.source} in (${sql.raw(sqlStringList(GAME_SOURCE))})`,
    ),
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
    game_id: uuid().references(() => game.id, {
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
    index("game_detection_mapping_game_idx").on(t.game_id),
  ],
)
