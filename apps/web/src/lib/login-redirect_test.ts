import { test } from "node:test"

import { sanitizeLoginRedirect } from "./login-redirect"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("sanitizeLoginRedirect accepts same-origin absolute paths", () => {
  const target =
    "/api/auth/desktop/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcallback"

  assert(
    sanitizeLoginRedirect(target) === target,
    "desktop authorize path should be preserved",
  )
})

test("sanitizeLoginRedirect rejects external-looking paths", () => {
  assert(sanitizeLoginRedirect("https://example.com") === null, "absolute URL")
  assert(sanitizeLoginRedirect("//example.com/path") === null, "protocol URL")
  assert(sanitizeLoginRedirect("/\\example.com/path") === null, "backslash URL")
})
