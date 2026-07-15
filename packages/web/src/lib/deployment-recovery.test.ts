import assert from "node:assert/strict"
import test from "node:test"

import { shouldReloadForDeployment } from "./deployment-recovery"

test("reloads only when the server advertises a different app shell", () => {
  assert.equal(shouldReloadForDeployment("build-a", "build-b", null), true)
  assert.equal(shouldReloadForDeployment("build-a", "build-a", null), false)
  assert.equal(shouldReloadForDeployment("build-a", null, null), false)
  assert.equal(shouldReloadForDeployment(null, "build-b", null), false)
})

test("does not reload the same target build twice", () => {
  assert.equal(
    shouldReloadForDeployment("build-a", "build-b", "build-b"),
    false,
  )
  assert.equal(shouldReloadForDeployment("build-a", "build-c", "build-b"), true)
})
