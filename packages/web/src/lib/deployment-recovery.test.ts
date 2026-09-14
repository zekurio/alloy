import assert from "node:assert/strict"

import { test } from "vitest"

import {
  WEB_BUILD_FOCUS_CHECK_MIN_GAP_MS,
  createWebBuildCheckScheduler,
  shouldNotifyForDeployment,
  shouldReloadForDeployment,
} from "./deployment-recovery"

test("reloads only for a different build it has not reloaded for yet", () => {
  assert.equal(shouldReloadForDeployment("a", "b", null), true)
  assert.equal(shouldReloadForDeployment("a", "a", null), false)
  assert.equal(shouldReloadForDeployment("a", null, null), false)
  assert.equal(shouldReloadForDeployment(null, "b", null), false)
  // Already reloaded for "b" once and still see the old build: a broken
  // deploy must not loop.
  assert.equal(shouldReloadForDeployment("a", "b", "b"), false)
})

test("notifies once per new build and stays quiet on rollback", () => {
  assert.equal(shouldNotifyForDeployment("a", "b", null), true)
  assert.equal(shouldNotifyForDeployment("a", "b", "b"), false)
  assert.equal(shouldNotifyForDeployment("a", "c", "b"), true)
  assert.equal(shouldNotifyForDeployment("a", "a", "b"), false)
  assert.equal(shouldNotifyForDeployment("a", null, null), false)
})

test("interval ticks always check, focus checks are rate limited", () => {
  let clock = 0
  let checks = 0
  const scheduler = createWebBuildCheckScheduler(
    () => {
      checks += 1
    },
    () => clock,
    () => true,
  )

  scheduler.resume()
  assert.equal(checks, 0, "fresh load counts as a check")

  clock += WEB_BUILD_FOCUS_CHECK_MIN_GAP_MS - 1
  scheduler.resume()
  assert.equal(checks, 0)

  clock += 1
  scheduler.resume()
  assert.equal(checks, 1)

  scheduler.resume()
  assert.equal(checks, 1, "a check resets the focus gap")

  scheduler.tick()
  assert.equal(checks, 2)
})

test("skips checks while offline", () => {
  let online = false
  let checks = 0
  const scheduler = createWebBuildCheckScheduler(
    () => {
      checks += 1
    },
    () => 0,
    () => online,
  )

  scheduler.tick()
  assert.equal(checks, 0)

  online = true
  scheduler.tick()
  assert.equal(checks, 1)
})
