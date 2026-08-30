import assert from "node:assert/strict"
import test from "node:test"

import { USER_ASSET_PATH_PREFIX } from "@alloy/contracts"
import { versionedUserAssetKey } from "@alloy/server/storage/driver"

import {
  internalUserAssetKey,
  prewriteUserAssetDeletionIntent,
  USER_ASSET_ROUTE_KEY_RE,
  userAssetConditionalUploadMatches,
  userAssetDeletionIntents,
} from "./user-asset-deletion"

const USER_ID = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
const OTHER_USER_ID = "22ebc58a-92f9-4f9d-b88c-3e89150b7d1e"
const VERSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const VERSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER_DIR = `11/eb/${USER_ID}`

test("new user asset attempts mint full UUID-versioned immutable keys", () => {
  const a = versionedUserAssetKey(USER_ID, "avatar", VERSION_A, ".webp")
  const b = versionedUserAssetKey(USER_ID, "avatar", VERSION_B, ".webp")
  assert.equal(a, `${USER_DIR}/avatar-${VERSION_A.replaceAll("-", "")}.webp`)
  assert.notEqual(a, b)
  assert.throws(() =>
    versionedUserAssetKey(USER_ID, "avatar", "aabbccddeeff", ".webp"),
  )
})

test("the serving route accepts legacy stable and full-version keys", () => {
  const stable = `${USER_DIR}/avatar.webp`
  const versioned = versionedUserAssetKey(USER_ID, "banner", VERSION_A, ".webp")
  assert.equal(USER_ASSET_ROUTE_KEY_RE.test(stable), true)
  assert.equal(USER_ASSET_ROUTE_KEY_RE.test(versioned), true)
  assert.equal(
    USER_ASSET_ROUTE_KEY_RE.test(`${USER_DIR}/avatar-aabbccddeeff.webp`),
    false,
  )
  assert.equal(USER_ASSET_ROUTE_KEY_RE.test(`${USER_DIR}/avatar.png`), false)
})

test("owned internal paths parse exactly and retain their key case", () => {
  const exactKey = `${USER_DIR}/avatar-${VERSION_A.replaceAll("-", "").toUpperCase()}.webp`
  assert.equal(
    internalUserAssetKey(
      `${USER_ASSET_PATH_PREFIX}${exactKey}?v=123`,
      USER_ID,
      "avatar",
    ),
    exactKey,
  )
  assert.equal(
    internalUserAssetKey(
      `${USER_ASSET_PATH_PREFIX}${USER_DIR}/avatar.webp?cache=1`,
      USER_ID,
      "avatar",
    ),
    `${USER_DIR}/avatar.webp`,
  )
})

test("producer parsing rejects external, prefix, cross-owner, and cross-role paths", () => {
  const ownKey = versionedUserAssetKey(USER_ID, "avatar", VERSION_A, ".webp")
  const crossOwnerKey = versionedUserAssetKey(
    OTHER_USER_ID,
    "avatar",
    VERSION_A,
    ".webp",
  )
  for (const candidate of [
    `https://example.test${USER_ASSET_PATH_PREFIX}${ownKey}`,
    `/api/assets/users-evil/${ownKey}`,
    `${USER_ASSET_PATH_PREFIX}${crossOwnerKey}`,
    `${USER_ASSET_PATH_PREFIX}${USER_DIR}/banner-${VERSION_A.replaceAll("-", "")}.webp`,
    `${USER_ASSET_PATH_PREFIX}${USER_DIR}/avatar-aabbccddeeff.webp`,
  ]) {
    assert.equal(internalUserAssetKey(candidate, USER_ID, "avatar"), null)
  }
})

test("serialized replacement and removal retire the actual prior version", () => {
  const legacy = `${USER_DIR}/avatar.webp`
  const a = versionedUserAssetKey(USER_ID, "avatar", VERSION_A, ".webp")
  const b = versionedUserAssetKey(USER_ID, "avatar", VERSION_B, ".webp")

  assert.equal(intentKeys(replacementIntents(legacy, a)).has(legacy), true)
  assert.equal(intentKeys(replacementIntents(a, b)).has(a), true)
  assert.equal(intentKeys(removalIntents(b)).has(b), true)
  assert.equal(intentKeys(replacementIntents(a, b)).has(b), false)
})

test("legacy role variants are safe candidates without adopting external URLs", () => {
  const intents = userAssetDeletionIntents({
    userId: USER_ID,
    role: "banner",
    previousUrl: "https://cdn.example.test/foreign-banner.webp",
    reason: "banner removed",
    source: { type: "user-asset", id: USER_ID },
    includeLegacyVariants: true,
  })
  assert.deepEqual(
    intentKeys(intents),
    new Set([
      `${USER_DIR}/banner.jpg`,
      `${USER_DIR}/banner.png`,
      `${USER_DIR}/banner.webp`,
    ]),
  )
  assert.equal(
    intents.some((intent) => intent.key.includes("example.test")),
    false,
  )
})

test("prewrite cleanup keeps a stable reservation identity across outcomes", () => {
  assert.deepEqual(
    prewriteUserAssetDeletionIntent({
      key: `${USER_DIR}/avatar-${VERSION_A.replaceAll("-", "")}.webp`,
      attemptId: VERSION_A,
      reason: "conditional user asset upload rejected",
    }),
    {
      namespace: "assets",
      key: `${USER_DIR}/avatar-${VERSION_A.replaceAll("-", "")}.webp`,
      reason: "conditional user asset upload rejected",
      source: { type: "storage-prewrite", id: VERSION_A },
    },
  )
})

test("conditional OAuth attachment rejects both value and revision races", () => {
  const expected = {
    currentUrl: null,
    revision: "2026-08-31 10:00:00.123456+00",
  }
  assert.equal(
    userAssetConditionalUploadMatches(null, expected.revision, expected),
    true,
  )
  assert.equal(
    userAssetConditionalUploadMatches(
      null,
      "2026-08-31 10:00:00.123457+00",
      expected,
    ),
    false,
  )
  assert.equal(
    userAssetConditionalUploadMatches(
      `${USER_ASSET_PATH_PREFIX}${USER_DIR}/avatar.webp`,
      expected.revision,
      expected,
    ),
    false,
  )
  assert.equal(userAssetConditionalUploadMatches(null, expected.revision), true)
})

function replacementIntents(previousKey: string, retainedKey: string) {
  return userAssetDeletionIntents({
    userId: USER_ID,
    role: "avatar",
    previousUrl: `${USER_ASSET_PATH_PREFIX}${previousKey}?v=1`,
    retainedKey,
    reason: "avatar replaced",
    source: { type: "user-asset", id: USER_ID },
    includeLegacyVariants: true,
  })
}

function removalIntents(previousKey: string) {
  return userAssetDeletionIntents({
    userId: USER_ID,
    role: "avatar",
    previousUrl: `${USER_ASSET_PATH_PREFIX}${previousKey}?v=1`,
    reason: "avatar removed",
    source: { type: "user-asset", id: USER_ID },
    includeLegacyVariants: true,
  })
}

function intentKeys(
  intents: readonly ReturnType<typeof userAssetDeletionIntents>[number][],
): Set<string> {
  return new Set(intents.map((intent) => intent.key))
}
