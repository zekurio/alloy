import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  accountSignInState,
  activeAccountState,
  disabledAccountState,
  selfReactivatedAccountState,
  type StoredAccountState,
} from "./account-state"

const ACTIVE: StoredAccountState = {
  status: "active",
  disabledAt: null,
  adminSuspendedAt: null,
}
const DISABLED_AT = new Date("2026-01-01T00:00:00.000Z")
const SUSPENDED_AT = new Date("2026-01-02T00:00:00.000Z")

test("active accounts can sign in normally", () => {
  assert.equal(accountSignInState(ACTIVE), "active")
})

test("self-disabled accounts must reactivate before signing in", () => {
  const disabled = disabledAccountState(ACTIVE, "self", DISABLED_AT)

  assert.deepEqual(disabled, {
    status: "disabled",
    disabledAt: DISABLED_AT,
    adminSuspendedAt: null,
  })
  assert.equal(accountSignInState(disabled), "reactivation-required")
  assert.deepEqual(selfReactivatedAccountState(disabled), activeAccountState())
})

test("administrator-suspended accounts cannot reactivate themselves", () => {
  const suspended = disabledAccountState(ACTIVE, "administrator", SUSPENDED_AT)

  assert.deepEqual(suspended, {
    status: "disabled",
    disabledAt: SUSPENDED_AT,
    adminSuspendedAt: SUSPENDED_AT,
  })
  assert.equal(accountSignInState(suspended), "banned")
  assert.equal(selfReactivatedAccountState(suspended), null)
})

test("administrator disable upgrades self-disable to suspension", () => {
  const selfDisabled = disabledAccountState(ACTIVE, "self", DISABLED_AT)
  const suspended = disabledAccountState(
    selfDisabled,
    "administrator",
    SUSPENDED_AT,
  )

  assert.equal(suspended.disabledAt, SUSPENDED_AT)
  assert.equal(suspended.adminSuspendedAt, SUSPENDED_AT)
})

test("self-disable preserves an administrator suspension", () => {
  const suspended = disabledAccountState(ACTIVE, "administrator", SUSPENDED_AT)
  const retried = disabledAccountState(suspended, "self", new Date())

  assert.equal(retried.adminSuspendedAt, SUSPENDED_AT)
  assert.equal(selfReactivatedAccountState(retried), null)
})

test("administrator activation clears all inactive state", () => {
  assert.deepEqual(activeAccountState(), ACTIVE)
})
