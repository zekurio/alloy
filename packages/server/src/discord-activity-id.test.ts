import assert from "node:assert/strict"
import test from "node:test"

import {
  decodeDiscordActivityId,
  encodeDiscordActivityId,
} from "./discord-activity-id"

const CLIP_ID = "7311ad7b-072b-4004-aacb-498de53b722b"
const SNOWCODE =
  "660866676659555353000359017052595401705652525670000002017056616003045755015954540166686621666756"
const V3_SNOWCODE =
  "660866676659555353000359017052595401705652525670000002017056616003045755015954540166686621666755"
const V2_SNOWCODE =
  "660866676659555353000359017052595401705652525670000002017056616003045755015954540166686621666754"
const LEGACY_SNOWCODE =
  "660866676659555353000359017052595401705652525670000002017056616003045755015954540166"

test("Discord activity IDs use FxEmbed's numeric snowcode format", () => {
  assert.equal(encodeDiscordActivityId(CLIP_ID), SNOWCODE)
  assert.equal(decodeDiscordActivityId(SNOWCODE), CLIP_ID)
  assert.equal(decodeDiscordActivityId(V3_SNOWCODE), CLIP_ID)
  assert.equal(decodeDiscordActivityId(V2_SNOWCODE), CLIP_ID)
  assert.equal(decodeDiscordActivityId(LEGACY_SNOWCODE), CLIP_ID)
})

test("Discord activity IDs reject malformed and non-clip payloads", () => {
  assert.equal(decodeDiscordActivityId(""), null)
  assert.equal(decodeDiscordActivityId("123"), null)
  assert.equal(decodeDiscordActivityId("not-numeric"), null)
  assert.equal(decodeDiscordActivityId("9999"), null)
  assert.equal(decodeDiscordActivityId("66086667660166"), null)
})
