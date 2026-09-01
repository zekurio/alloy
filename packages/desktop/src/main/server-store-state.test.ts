import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { normalizeState, upsertServer } from "./server-store-state"

test("requires pre-remote saved servers to be reprobed", () => {
  const state = normalizeState({
    version: 2,
    servers: [
      {
        serverUrl: "https://alloy.example",
        lastConnectedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  })

  assert.equal(state.servers[0]?.httpContract, 0)
  assert.equal(state.servers[0]?.bridgeContract, 0)
})

test("persists exact HTTP and bridge contracts for startup", () => {
  const servers = upsertServer(
    [],
    "https://alloy.example",
    7,
    3,
    new Date("2026-01-01T00:00:00.000Z"),
  )

  assert.deepEqual(servers[0], {
    serverUrl: "https://alloy.example",
    lastConnectedAt: "2026-01-01T00:00:00.000Z",
    httpContract: 7,
    bridgeContract: 3,
  })
})
