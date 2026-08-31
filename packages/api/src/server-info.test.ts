import assert from "node:assert/strict"

import type { ServerInfo } from "@alloy/contracts"
import { SERVER_HTTP_CONTRACT_1_FIXTURE } from "@alloy/contracts/server-http-fixtures"
import { test } from "vite-plus/test"

import type { ApiContext } from "./client"
import { createServerInfoApi } from "./server-info"

type RequestContext = Pick<ApiContext, "request">

function contextFor(body: ServerInfo) {
  let path: string | null = null
  const context = {
    request: async (requestPath: string) => {
      path = requestPath
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      })
    },
  } satisfies RequestContext
  return { context, requestedPath: () => path }
}

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

test("fetches and runtime-validates server info through the low-level client", async () => {
  const { context, requestedPath } = contextFor(fixture())

  const result = await createServerInfoApi(context).fetch()

  assert.equal(requestedPath(), "/api/server-info")
  assert.equal(result.product, "alloy")
  assert.deepEqual(result.httpContracts, [1])
})

test("rejects malformed known capabilities instead of trusting TypeScript", async () => {
  const value = fixture()
  value.capabilities.auth.desktopAuth = 2
  const { context } = contextFor(value)

  await assert.rejects(() => createServerInfoApi(context).fetch())
})
