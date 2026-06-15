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
    // IGDB is the canonical game identity. This table is a durable
    // metadata cache, not a second identity namespace.
    igdbId: integer("igdb_id").primaryKey(),
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
    igdbId: integer("igdb_id")
      .notNull()
      .references(() => game.igdbId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_follow_pair_idx").on(t.userId, t.igdbId),
    // Reverse lookup for the feed-ranking join ("is this clip's game
    // followed by the viewer?"), and for per-game follower counts.
    index("game_follow_igdb_idx").on(t.igdbId),
  ],
)

export const gameDetectionMapping = pgTable(
  "game_detection_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceId: text("source_id"),
    executable: text("executable"),
    normalizedName: text("normalized_name").notNull(),
    igdbId: integer("igdb_id").references(() => game.igdbId, {
      onDelete: "set null",
    }),
    status: text("status").$type<"auto" | "confirmed" | "rejected">().notNull(),
    confidence: real("confidence").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("game_detection_mapping_source_idx").on(t.source, t.sourceId),
    index("game_detection_mapping_executable_idx").on(t.executable),
    index("game_detection_mapping_name_idx").on(t.normalizedName),
    index("game_detection_mapping_igdb_idx").on(t.igdbId),
  ],
)
