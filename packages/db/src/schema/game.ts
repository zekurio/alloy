import {
  index,
  integer,
  pgTable,
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
    steamgriddbId: integer("steamgriddb_id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    releaseDate: timestamp("release_date"),
    heroUrl: text("hero_url"),
    heroBlurHash: text("hero_blur_hash"),
    gridUrl: text("grid_url"),
    gridBlurHash: text("grid_blur_hash"),
    logoUrl: text("logo_url"),
    iconUrl: text("icon_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("game_name_idx").on(t.name)],
)

export const gameFollow = pgTable(
  "game_follow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    steamgriddbId: integer("steamgriddb_id")
      .notNull()
      .references(() => game.steamgriddbId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_follow_pair_idx").on(t.userId, t.steamgriddbId),
    // Reverse lookup for the feed-ranking join ("is this clip's game
    // followed by the viewer?"), and for per-game follower counts.
    index("game_follow_steamgriddb_idx").on(t.steamgriddbId),
  ],
)
