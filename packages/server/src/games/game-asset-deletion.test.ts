import assert from "node:assert/strict"
import test from "node:test"

import { GAME_ASSET_PATH_PREFIX } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { versionedAssetKey } from "@alloy/server/storage/driver"

import {
  GAME_ASSET_ROUTE_KEY_RE,
  gameAssetDeletionIntents,
  internalGameAssetKey,
} from "./game-asset-deletion"

const GAME_ID = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
const OTHER_GAME_ID = "22ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
const VERSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const VERSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const GAME_DIR = `11/eb/${GAME_ID}`

test("game asset keys are immutable and legacy URLs stay readable", () => {
  const key = versionedAssetKey(GAME_ID, "hero", VERSION_A)
  assert.equal(key, `${GAME_DIR}/hero-${VERSION_A.replaceAll("-", "")}.webp`)
  assert.equal(GAME_ASSET_ROUTE_KEY_RE.test(key), true)
  assert.equal(GAME_ASSET_ROUTE_KEY_RE.test(`${GAME_DIR}/hero.webp`), true)
  assert.equal(
    GAME_ASSET_ROUTE_KEY_RE.test(`${GAME_DIR}/hero-aabbccddeeff.webp`),
    false,
  )
  assert.throws(() => versionedAssetKey(GAME_ID, "hero", "aabbccddeeff"))
})

test("owned game asset paths parse exactly and retain their key case", () => {
  const key = `${GAME_DIR}/hero-${VERSION_A.replaceAll("-", "").toUpperCase()}.webp`
  assert.equal(
    internalGameAssetKey(
      `${GAME_ASSET_PATH_PREFIX}${key}?v=123`,
      GAME_ID,
      "hero",
    ),
    key,
  )
  assert.equal(
    internalGameAssetKey(
      `${GAME_ASSET_PATH_PREFIX}${GAME_DIR}/hero.webp?v=1`,
      GAME_ID,
      "hero",
    ),
    `${GAME_DIR}/hero.webp`,
  )
})

test("game asset ownership rejects external, prefix, owner, role, shard, and short-version aliases", () => {
  const own = versionedAssetKey(GAME_ID, "hero", VERSION_A)
  const other = versionedAssetKey(OTHER_GAME_ID, "hero", VERSION_A)
  for (const candidate of [
    `https://example.test${GAME_ASSET_PATH_PREFIX}${own}`,
    `/api/assets/games-evil/${own}`,
    `${GAME_ASSET_PATH_PREFIX}${other}`,
    `${GAME_ASSET_PATH_PREFIX}${GAME_DIR}/grid-${VERSION_A.replaceAll("-", "")}.webp`,
    `${GAME_ASSET_PATH_PREFIX}ff/ff/${GAME_ID}/hero-${VERSION_A.replaceAll("-", "")}.webp`,
    `${GAME_ASSET_PATH_PREFIX}${GAME_DIR}/hero-aabbccddeeff.webp`,
  ]) {
    assert.equal(internalGameAssetKey(candidate, GAME_ID, "hero"), null)
  }
})

test("replacement and removal retire the locked predecessor but never the retained version", () => {
  const a = versionedAssetKey(GAME_ID, "logo", VERSION_A)
  const b = versionedAssetKey(GAME_ID, "logo", VERSION_B)
  const replacement = gameAssetDeletionIntents({
    gameId: GAME_ID,
    role: "logo",
    previousUrl: `${GAME_ASSET_PATH_PREFIX}${a}?v=1`,
    retainedKey: b,
    reason: "logo replaced",
    source: { type: "game-asset", id: GAME_ID },
    includeLegacyVariant: true,
  })
  assert.equal(
    replacement.some(({ key }) => key === a),
    true,
  )
  assert.equal(
    replacement.some(({ key }) => key === b),
    false,
  )
  assert.equal(
    replacement.some(({ key }) => key === `${GAME_DIR}/logo.webp`),
    true,
  )
})

test("external URLs never become deletion authority", () => {
  const intents = gameAssetDeletionIntents({
    gameId: GAME_ID,
    role: "icon",
    previousUrl: "https://cdn.example.test/icon.webp",
    reason: "icon removed",
    source: { type: "game-asset", id: GAME_ID },
    includeLegacyVariant: true,
  })
  assert.deepEqual(
    intents.map(({ key }) => key),
    [`${GAME_DIR}/icon.webp`],
  )
})

test("URL patches cannot re-adopt a relative internal asset path", () => {
  const key = versionedAssetKey(GAME_ID, "grid", VERSION_A)
  assert.equal(
    t.url().safeParse(`${GAME_ASSET_PATH_PREFIX}${key}`).success,
    false,
  )
  assert.equal(
    t.url().safeParse(`https://cdn.example.test/${key}`).success,
    true,
  )
})
