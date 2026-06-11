import { test } from "node:test"

import { Hono } from "hono"

import { rateLimiter } from "./rate-limit"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function testApp(input: {
  max: number
  now: () => number
  key: string | null | ((key: string | null) => string | null)
}) {
  const app = new Hono()
  app.use(
    "*",
    rateLimiter({
      windowMs: 1000,
      max: input.max,
      now: input.now,
      key: (c) => {
        const key = c.req.header("x-test-key") ?? null
        return typeof input.key === "function" ? input.key(key) : input.key
      },
    }),
  )
  app.get("/", (c) => c.text("ok"))
  return app
}

test("rateLimiter allows requests up to the configured limit", async () => {
  let now = 0
  const app = testApp({ max: 2, now: () => now, key: "client" })

  assertEqual((await app.request("/")).status, 200, "first request")
  now = 100
  assertEqual((await app.request("/")).status, 200, "second request")
})

test("rateLimiter returns 429 with Retry-After after the limit", async () => {
  const app = testApp({ max: 2, now: () => 250, key: "client" })

  await app.request("/")
  await app.request("/")
  const res = await app.request("/")

  assertEqual(res.status, 429, "third request should be rate limited")
  assertEqual(res.headers.get("Retry-After"), "1", "retry-after seconds")
})

test("rateLimiter resets a key after the window expires", async () => {
  let now = 0
  const app = testApp({ max: 1, now: () => now, key: "client" })

  assertEqual((await app.request("/")).status, 200, "first request")
  assertEqual((await app.request("/")).status, 429, "same-window request")

  now = 1000
  assertEqual((await app.request("/")).status, 200, "next-window request")
})

test("rateLimiter tracks distinct keys independently", async () => {
  const app = testApp({
    max: 1,
    now: () => 0,
    key: (key) => key,
  })

  assertEqual(
    (await app.request("/", { headers: { "x-test-key": "a" } })).status,
    200,
    "first client",
  )
  assertEqual(
    (await app.request("/", { headers: { "x-test-key": "b" } })).status,
    200,
    "second client",
  )
  assertEqual(
    (await app.request("/", { headers: { "x-test-key": "a" } })).status,
    429,
    "first client over limit",
  )
})

test("rateLimiter bypasses requests whose key is null", async () => {
  const app = testApp({ max: 0, now: () => 0, key: null })

  const first = await app.request("/")
  const second = await app.request("/")

  assert(first.ok, "first request should bypass")
  assert(second.ok, "second request should bypass")
})
