import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  desktopOriginArgument,
  desktopOriginFromArguments,
  isTrustedDesktopOrigin,
} from "./desktop-origin"

test("passes one normalized server origin from main to preload", () => {
  const argument = desktopOriginArgument("https://alloy.example/path?q=1")
  assert.equal(
    desktopOriginFromArguments(["electron", argument]),
    "https://alloy.example",
  )
})

test("rejects malformed, credentialed, and non-http origin arguments", () => {
  assert.equal(desktopOriginFromArguments([]), null)
  assert.equal(
    desktopOriginFromArguments(["--alloy-server-origin=%E0%A4%A"]),
    null,
  )
  assert.throws(() => desktopOriginArgument("file:///tmp/app"))
  assert.throws(() => desktopOriginArgument("https://user@example.com"))
})

test("trusts every path on only the selected exact origin", () => {
  assert.equal(
    isTrustedDesktopOrigin(
      "https://alloy.example/library?tab=clips",
      "https://alloy.example",
    ),
    true,
  )
  assert.equal(
    isTrustedDesktopOrigin(
      "https://cdn.alloy.example/library",
      "https://alloy.example",
    ),
    false,
  )
  assert.equal(
    isTrustedDesktopOrigin(
      "https://alloy.example.evil.test/",
      "https://alloy.example",
    ),
    false,
  )
})
