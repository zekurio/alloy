import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { normalizeState, upsertServer } from "./server-store-state"

test("migrates pre-cut saved servers to the implicit contract-1 baseline", () => {
  const state = normalizeState({
    version: 2,
    servers: [
      {
        serverUrl: "https://alloy.example",
        lastConnectedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  })

  assert.equal(state.servers[0]?.httpContract, 1)
})

test("persists exact HTTP contract IDs for offline startup", () => {
  const servers = upsertServer(
    [],
    "https://alloy.example",
    7,
    new Date("2026-01-01T00:00:00.000Z"),
  )

  assert.deepEqual(servers[0], {
    serverUrl: "https://alloy.example",
    lastConnectedAt: "2026-01-01T00:00:00.000Z",
    httpContract: 7,
  })
})
