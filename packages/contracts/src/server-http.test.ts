import assert from "node:assert/strict"

import { test } from "vitest"

import {
  TAURI_DESKTOP_BRIDGE_CONTRACT_IDS,
  DESKTOP_HTTP_CONTRACT_IDS,
  ServerInfoSchema,
  type ServerInfo,
} from "./index"
import { SERVER_HTTP_CONTRACT_1_FIXTURE } from "./server-http-fixtures"

function fixture(): ServerInfo {
  return {
    ...SERVER_HTTP_CONTRACT_1_FIXTURE,
    httpContracts: [...SERVER_HTTP_CONTRACT_1_FIXTURE.httpContracts],
    desktopTauriBridgeContracts: [
      ...SERVER_HTTP_CONTRACT_1_FIXTURE.desktopTauriBridgeContracts,
    ],
    capabilities: {
      auth: { ...SERVER_HTTP_CONTRACT_1_FIXTURE.capabilities.auth },
      transport: {
        ...SERVER_HTTP_CONTRACT_1_FIXTURE.capabilities.transport,
      },
    },
  }
}

test("accepts the contract-1 server-info response", () => {
  const value = fixture()

  assert.equal(ServerInfoSchema.safeParse(value).success, true)
  assert.deepEqual(value.schema, "alloy.server-info")
  assert.deepEqual(value.product, "alloy")
  assert.deepEqual(value.httpContracts, [1])
  assert.deepEqual(value.desktopTauriBridgeContracts, [1])
  assert.deepEqual(DESKTOP_HTTP_CONTRACT_IDS, [1])
  assert.deepEqual(TAURI_DESKTOP_BRIDGE_CONTRACT_IDS, [1])
})

test("requires the native bridge contract list", () => {
  const { desktopTauriBridgeContracts: _omitted, ...value } = fixture()

  assert.equal(ServerInfoSchema.safeParse(value).success, false)
})

test("rejects a mutation of any known capability version", () => {
  const desktopAuth = fixture()
  desktopAuth.capabilities.auth.desktopAuth = 2

  const sessionCookies = fixture()
  sessionCookies.capabilities.auth.sessionCookies = 2

  const json = fixture()
  json.capabilities.transport.json = 2

  const credentialedFetch = fixture()
  credentialedFetch.capabilities.transport.credentialedFetch = 2

  for (const value of [desktopAuth, sessionCookies, json, credentialedFetch]) {
    assert.equal(ServerInfoSchema.safeParse(value).success, false)
  }
})

test("rejects coercible values at the HTTP boundary", () => {
  const stringContract = { ...fixture(), httpContracts: ["1"] }
  const fractionalContract = { ...fixture(), httpContracts: [1.1] }
  const stringBridgeContract = {
    ...fixture(),
    desktopTauriBridgeContracts: ["1"],
  }
  const stringCapability = {
    ...fixture(),
    capabilities: {
      ...fixture().capabilities,
      auth: { desktopAuth: "1", sessionCookies: 1 },
    },
  }
  const numericVersion = { ...fixture(), version: 112 }

  for (const value of [
    stringContract,
    fractionalContract,
    stringBridgeContract,
    stringCapability,
    numericVersion,
  ]) {
    assert.equal(ServerInfoSchema.safeParse(value).success, false)
  }
})

test("accepts appended document and capability fields and unknown contract IDs", () => {
  const value = fixture()
  const futureValue = {
    ...value,
    httpContracts: [...value.httpContracts, 27],
    futureDocumentField: { version: 9 },
    capabilities: {
      ...value.capabilities,
      auth: {
        ...value.capabilities.auth,
        futureAuth: { version: 9 },
      },
      transport: {
        ...value.capabilities.transport,
        futureTransport: 9,
      },
    },
  }

  assert.equal(ServerInfoSchema.safeParse(futureValue).success, true)
})
