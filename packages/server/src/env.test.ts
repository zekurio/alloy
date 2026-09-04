import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { parseServerEnv } from "./env"

const REQUIRED_ENV = {
  DATABASE_URL: "postgres://localhost/alloy-test",
  ALLOY_VIEWER_COOKIE_SECRET: "v".repeat(32),
  ALLOY_UPLOAD_HMAC_SECRET: "u".repeat(32),
}

test("production rejects a remote HTTP public server URL", () => {
  assert.throws(
    () =>
      parseServerEnv({
        ...REQUIRED_ENV,
        NODE_ENV: "production",
        PUBLIC_SERVER_URL: "http://alloy.example",
      }),
    /PUBLIC_SERVER_URL must use HTTPS in production/,
  )
})

test("production accepts an external HTTPS public server URL", () => {
  const parsed = parseServerEnv({
    ...REQUIRED_ENV,
    NODE_ENV: "production",
    PUBLIC_SERVER_URL: "https://alloy.example",
  })

  assert.equal(parsed.PUBLIC_SERVER_URL, "https://alloy.example")
})

test("development accepts a loopback HTTP public server URL", () => {
  const parsed = parseServerEnv({
    ...REQUIRED_ENV,
    NODE_ENV: "development",
    PUBLIC_SERVER_URL: "http://127.0.0.1:2552",
  })

  assert.equal(parsed.PUBLIC_SERVER_URL, "http://127.0.0.1:2552")
})

test("production still rejects loopback HTTPS origins", () => {
  assert.throws(
    () =>
      parseServerEnv({
        ...REQUIRED_ENV,
        NODE_ENV: "production",
        PUBLIC_SERVER_URL: "https://localhost:2552",
      }),
    /PUBLIC_SERVER_URL must be the externally reachable origin in production/,
  )
})
