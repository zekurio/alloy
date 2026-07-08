import assert from "node:assert/strict"
import { test } from "node:test"

import { JOB_KINDS } from "@alloy/contracts"
// Register kinds through the same module the server boots with, so a kind
// file that is added but never wired into jobs/index.ts fails this suite.
// Importing parses server env but never touches the database, so this runs
// without ALLOY_TEST_DATABASE_URL — CI provides import-safe env values.
import "@alloy/server/jobs/index"

import { registeredJobKinds } from "./registry"

test("registered job kinds exactly match the contracts JOB_KINDS list", () => {
  // defineJobKind() only accepts contract kinds, so the interesting failure
  // here is the reverse: a kind that was removed from the server (or never
  // wired into jobs/index.ts) while still being declared in the contract.
  const registered = registeredJobKinds()
    .map((registration) => registration.kind)
    .sort()
  assert.deepEqual(registered, [...JOB_KINDS].sort())
})
