import { GAME_SOURCE, type GameSource } from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
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
    // SteamGridDB refresh schedule. `refresh_after` is the earliest time the
    // next refresh may run; null for custom games, which never refresh.
    // Failed refreshes stamp a backoff here and count in `refresh_failures`,
    // so an upstream outage or a deleted game does not cost a SteamGridDB
    // round-trip on every read.
    refresh_after: timestamp(),
    refresh_failures: integer().notNull().default(0),
  },
  (t) => [
    index("game_name_idx").on(t.name),
    check(
      "game_source_check",
      sql`${t.source} in (${sql.raw(sqlStringList(GAME_SOURCE))})`,
    ),
  ],
)
