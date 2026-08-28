import assert from "node:assert/strict"
import test from "node:test"

import { evaluateServerInfoResponse } from "./server-http-contract"

function serverInfo(httpContracts: Array<number | string>) {
  return {
    schema: "alloy.server-info",
    product: "alloy",
    version: "1.2.3",
    httpContracts,
    capabilities: {
      auth: { desktopAuth: 1, sessionCookies: 1 },
      transport: { json: 1, credentialedFetch: 1 },
    },
  }
}

test("treats only a missing server-info endpoint as implicit contract 1", () => {
  assert.deepEqual(evaluateServerInfoResponse(404, null), {
    ok: true,
    implicitContract1: true,
  })
  assert.equal(evaluateServerInfoResponse(500, null).ok, false)
  assert.equal(evaluateServerInfoResponse(302, null).ok, false)
})

test("requires exact contract 1 membership in validated server info", () => {
  assert.deepEqual(evaluateServerInfoResponse(200, serverInfo([1, 2])), {
    ok: true,
    implicitContract1: false,
  })
  assert.equal(evaluateServerInfoResponse(200, serverInfo([2, 3])).ok, false)
  assert.equal(
    evaluateServerInfoResponse(200, serverInfo([1.1, "1"])).ok,
    false,
  )
  assert.equal(
    evaluateServerInfoResponse(200, { httpContracts: [1] }).ok,
    false,
  )
  assert.equal(evaluateServerInfoResponse(200, null).ok, false)
})

test("rejects changed known capability versions", () => {
  const changed = {
    ...serverInfo([1]),
    capabilities: {
      auth: { desktopAuth: 1, sessionCookies: 1 },
      transport: { json: 1, credentialedFetch: 2 },
    },
  }
  assert.equal(evaluateServerInfoResponse(200, changed).ok, false)
})
