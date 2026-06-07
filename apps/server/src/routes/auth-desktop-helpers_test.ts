import { test } from "node:test"

import { loopbackRedirect } from "./auth-desktop-helpers"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("loopbackRedirect accepts only HTTP loopback callback URLs", () => {
  assert(
    loopbackRedirect("http://127.0.0.1:1234/callback")?.hostname ===
      "127.0.0.1",
    "IPv4 loopback should be accepted",
  )
  assert(
    loopbackRedirect("http://localhost:1234/callback")?.hostname ===
      "localhost",
    "localhost should be accepted",
  )
  assert(
    loopbackRedirect("https://127.0.0.1:1234/callback") === null,
    "HTTPS loopback is not the RFC 8252 callback this flow binds to",
  )
  assert(
    loopbackRedirect("http://example.com/callback") === null,
    "remote host should be rejected",
  )
  assert(
    loopbackRedirect("file:///tmp/callback") === null,
    "non-HTTP protocol should be rejected",
  )
})
