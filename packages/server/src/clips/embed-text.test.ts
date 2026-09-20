import assert from "node:assert/strict"

import { test } from "vitest"

import { clipEmbedDescription } from "./embed-text"

test("clip descriptions link the game for Fluxer and stay plain for other crawlers", () => {
  const clip = {
    gameName: "Valorant",
    gameSlug: "valorant",
    viewCount: 1_234,
  }
  const origin = "https://alloy.example"

  assert.equal(
    clipEmbedDescription(clip, origin, "Fluxerbot/1.0"),
    "[Valorant](https://alloy.example/games/valorant)",
  )
  for (const userAgent of [
    undefined,
    "Mozilla/5.0",
    "Discordbot/2.0",
    "NotFluxerbot/1.0",
  ]) {
    assert.equal(clipEmbedDescription(clip, origin, userAgent), "Valorant")
  }
  assert.equal(
    clipEmbedDescription(
      { gameName: "Uncategorised", gameSlug: null },
      origin,
      "Fluxerbot/1.0",
    ),
    "Uncategorised",
  )
  assert.equal(
    clipEmbedDescription(
      { gameName: "Game [Deluxe] *Plus* \\ Remix", gameSlug: "game-variant" },
      origin,
      "Mozilla/5.0 (compatible; Fluxerbot/1.0)",
    ),
    "[Game \\[Deluxe\\] \\*Plus\\* \\\\ Remix](https://alloy.example/games/game-variant)",
  )
})
