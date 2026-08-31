import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  DESKTOP_HTTP_CONTRACT_1,
  DESKTOP_HTTP_CONTRACT_IDS,
  ServerInfoSchema,
  isServerInfo,
  type ServerInfo,
  selectDesktopHttpContract,
  supportsDesktopHttpContract,
} from "./index"
import { SERVER_HTTP_CONTRACT_1_FIXTURE } from "./server-http-fixtures"

function fixture(): ServerInfo {
  return {
    ...SERVER_HTTP_CONTRACT_1_FIXTURE,
    httpContracts: [...SERVER_HTTP_CONTRACT_1_FIXTURE.httpContracts],
    capabilities: {
      auth: { ...SERVER_HTTP_CONTRACT_1_FIXTURE.capabilities.auth },
      transport: {
        ...SERVER_HTTP_CONTRACT_1_FIXTURE.capabilities.transport,
      },
    },
  }
}

test("accepts the frozen contract-1 wire fixture", () => {
  const value = fixture()

  assert.equal(isServerInfo(value), true)
  assert.equal(selectDesktopHttpContract(value), DESKTOP_HTTP_CONTRACT_1)
  assert.equal(supportsDesktopHttpContract(value, 1), true)
  assert.deepEqual(value.schema, "alloy.server-info")
  assert.deepEqual(value.product, "alloy")
})

test("accepts unknown future contract IDs without selecting them", () => {
  const value = fixture()
  value.httpContracts.push(27)

  assert.equal(isServerInfo(value), true)
  assert.equal(selectDesktopHttpContract(value), DESKTOP_HTTP_CONTRACT_1)
  assert.equal(supportsDesktopHttpContract(value, 27), false)
})

test("rejects a valid document that does not advertise contract 1", () => {
  const value = fixture()
  value.httpContracts = [2]

  assert.equal(isServerInfo(value), true)
  assert.equal(selectDesktopHttpContract(value), null)
  assert.equal(supportsDesktopHttpContract(value, 2), false)
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
    assert.equal(selectDesktopHttpContract(value), null)
  }
})

test("rejects coercible values at the HTTP boundary", () => {
  const stringContract = { ...fixture(), httpContracts: ["1"] }
  const fractionalContract = { ...fixture(), httpContracts: [1.1] }
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
    stringCapability,
    numericVersion,
  ]) {
    assert.equal(ServerInfoSchema.safeParse(value).success, false)
    assert.equal(selectDesktopHttpContract(value), null)
  }
})

test("accepts appended document and capability fields", () => {
  const value = fixture()
  const futureValue = {
    ...value,
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
  const parsed = ServerInfoSchema.safeParse(futureValue)

  assert.equal(parsed.success, true)
  assert.equal(selectDesktopHttpContract(futureValue), DESKTOP_HTTP_CONTRACT_1)
})

test("does not use the informational app version for compatibility", () => {
  const value = { ...fixture(), version: "999.999.999" }

  assert.equal(selectDesktopHttpContract(value), DESKTOP_HTTP_CONTRACT_1)
  assert.deepEqual(DESKTOP_HTTP_CONTRACT_IDS, [1])
})
