import assert from "node:assert/strict"
import { test } from "node:test"

import {
  profileIdentityChanged,
  profileIdentityPatch,
} from "./profile-identity"

const INITIAL = {
  email: "zek@example.com",
  username: "zekurio",
  displayName: "Michael",
}

test("an unchanged form produces no patch", () => {
  assert.deepEqual(profileIdentityPatch({ ...INITIAL }, INITIAL), {})
  assert.equal(profileIdentityChanged({ ...INITIAL }, INITIAL), false)
})

test("setting a display name patches only that field", () => {
  assert.deepEqual(
    profileIdentityPatch(
      { ...INITIAL, displayName: "Michael S." },
      { ...INITIAL, displayName: "" },
    ),
    { displayName: "Michael S." },
  )
})

test("clearing a display name sends an empty string, not nothing", () => {
  // The empty string is what tells the server to null the column. If this were
  // folded into "unchanged", clearing a display name would silently no-op.
  assert.deepEqual(
    profileIdentityPatch({ ...INITIAL, displayName: "" }, INITIAL),
    { displayName: "" },
  )
  assert.equal(
    profileIdentityChanged({ ...INITIAL, displayName: "" }, INITIAL),
    true,
  )
})

test("whitespace-only edits to a display name are not a change", () => {
  assert.deepEqual(
    profileIdentityPatch({ ...INITIAL, displayName: "  Michael  " }, INITIAL),
    {},
  )
})

test("email casing alone is not a change but username casing is", () => {
  assert.deepEqual(
    profileIdentityPatch({ ...INITIAL, email: "ZEK@example.com" }, INITIAL),
    {},
  )
  assert.deepEqual(
    profileIdentityPatch({ ...INITIAL, username: "Zekurio" }, INITIAL),
    { username: "Zekurio" },
  )
})
