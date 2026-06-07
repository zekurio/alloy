import { test } from "node:test"

import { candidateUrls } from "./probe"
import { canOpenExternally, sameOrigin } from "./url-policy"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("candidateUrls only allows HTTP for loopback servers", () => {
  const remote = candidateUrls("alloy.example.com")
  assert(remote.length === 1, "remote bare host should only produce HTTPS")
  assert(
    remote[0] === "https://alloy.example.com",
    "remote bare host should normalize to HTTPS",
  )

  const local = candidateUrls("localhost:2552")
  assert(
    local.includes("https://localhost:2552"),
    "localhost should try HTTPS first",
  )
  assert(
    local.includes("http://localhost:2552"),
    "localhost should allow HTTP for local development",
  )

  const insecureRemote = candidateUrls("http://alloy.example.com")
  assert(insecureRemote.length === 0, "explicit remote HTTP should be rejected")
})

test("canOpenExternally rejects shell-dangerous protocols", () => {
  assert(canOpenExternally("https://example.com"), "HTTPS should be external")
  assert(canOpenExternally("http://example.com"), "HTTP should be external")
  assert(!canOpenExternally("file:///tmp/a"), "file URLs should be blocked")
  assert(!canOpenExternally("javascript:alert(1)"), "javascript URLs block")
  assert(!canOpenExternally("alloy://callback"), "custom protocols block")
})

test("sameOrigin uses URL origin parsing", () => {
  assert(
    sameOrigin("https://alloy.example.com/clips", "https://alloy.example.com"),
    "same origin path should be allowed",
  )
  assert(
    !sameOrigin(
      "https://alloy.example.com.attacker.test",
      "https://alloy.example.com",
    ),
    "lookalike host should be rejected",
  )
})
