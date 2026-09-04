import assert from "node:assert/strict"

import { AUTH_ERROR_CODES } from "@alloy/contracts"
import { test } from "vite-plus/test"

import { HttpError, readJsonOrThrow } from "./http"

test("coded authentication errors survive the HTTP boundary", async () => {
  const response = Response.json(
    {
      error: {
        code: AUTH_ERROR_CODES.accountReactivationRequired,
        message: "Reactivate your account to finish signing in.",
      },
    },
    { status: 409 },
  )

  await assert.rejects(
    readJsonOrThrow(response, () => null),
    (cause: unknown) => {
      assert.ok(cause instanceof HttpError)
      assert.equal(cause.status, 409)
      assert.equal(cause.code, AUTH_ERROR_CODES.accountReactivationRequired)
      assert.equal(
        cause.message,
        "Reactivate your account to finish signing in.",
      )
      return true
    },
  )
})
