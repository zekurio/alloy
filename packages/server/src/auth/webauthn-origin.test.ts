import assert from "node:assert/strict"
import test from "node:test"

import {
  webAuthnChallengeContext,
  webAuthnRpIdForOrigin,
} from "./webauthn-origin"

test("uses the public rp id when it matches the request origin host", () => {
  assert.deepEqual(
    webAuthnChallengeContext({
      publicServerUrl: "http://localhost:2552",
      requestOrigin: "http://localhost:5173",
      trustedOrigins: ["http://localhost:5173"],
    }),
    { origin: "http://localhost:5173", rpId: "localhost" },
  )
})

test("uses the trusted request host when the public rp id is invalid there", () => {
  assert.deepEqual(
    webAuthnChallengeContext({
      publicServerUrl: "http://localhost:2552",
      requestOrigin: "http://127.0.0.1:5173",
      trustedOrigins: ["http://127.0.0.1:5173"],
    }),
    { origin: "http://127.0.0.1:5173", rpId: "127.0.0.1" },
  )
})

test("ignores untrusted request origins", () => {
  assert.deepEqual(
    webAuthnChallengeContext({
      publicServerUrl: "http://localhost:2552",
      requestOrigin: "http://127.0.0.1:5173",
      trustedOrigins: ["http://localhost:5173"],
    }),
    { origin: "http://localhost:2552", rpId: "localhost" },
  )
})

test("keeps a parent-domain rp id for subdomain origins", () => {
  assert.equal(
    webAuthnRpIdForOrigin(
      "https://alloy.example.com",
      "https://clips.alloy.example.com",
    ),
    "alloy.example.com",
  )
})
