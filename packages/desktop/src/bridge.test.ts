import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

import type { AlloyTauriDesktop } from "@alloy/desktop-contracts/desktop-tauri"
import { test } from "vitest"

const source = readFileSync(
  new URL("../src-tauri/src/bridge.js", import.meta.url),
  "utf8",
).replace(
  '"__ALLOY_SELECTED_ORIGIN__"',
  JSON.stringify("https://alloy.example"),
)

interface BridgeWindow {
  location: { origin: string }
  top?: unknown
  alloyTauriDesktop?: AlloyTauriDesktop
  __TAURI_INTERNALS__: object
  __TAURI_EVENT_PLUGIN_INTERNALS__: object
}

interface NativeArguments {
  operation?: string
  args?: (string | number[] | boolean)[]
  event?: string
  target?: { kind: string }
  handler?: number
  eventId?: number
}

function loadBridge(origin = "https://alloy.example", childFrame = false) {
  const calls: { command: string; args: NativeArguments }[] = []
  const callbacks = new Map<number, (event: { payload: unknown }) => void>()
  let completeListen: (id: number) => void = () => {}
  const listen = new Promise<number>((resolve) => {
    completeListen = resolve
  })
  const window: BridgeWindow = {
    location: { origin },
    __TAURI_INTERNALS__: {
      invoke(command: string, args: NativeArguments) {
        calls.push({ command, args })
        return command === "plugin:event|listen"
          ? listen
          : Promise.resolve(null)
      },
      transformCallback(callback: (event: { payload: unknown }) => void) {
        callbacks.set(7, callback)
        return 7
      },
      unregisterCallback(id: number) {
        callbacks.delete(id)
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
  }
  window.top = childFrame ? {} : window
  // The bridge registers a titlebar drag listener at load; the sandbox only
  // needs the registration to succeed.
  runInNewContext(source, { window, document: { addEventListener() {} } })
  return { window, calls, callbacks, completeListen }
}

test("native bridge is absent on another origin and in child frames", () => {
  assert.equal(
    loadBridge("https://elsewhere.example").window.alloyTauriDesktop,
    undefined,
  )
  assert.equal(
    loadBridge("https://alloy.example", true).window.alloyTauriDesktop,
    undefined,
  )
})

test("server management calls use the dotted operation names", async () => {
  const { window, calls } = loadBridge()
  assert.ok(window.alloyTauriDesktop)
  await window.alloyTauriDesktop.servers.switchTo("https://alloy.example")
  await window.alloyTauriDesktop.servers.list()
  await window.alloyTauriDesktop.servers.current()
  await window.alloyTauriDesktop.servers.forget("https://alloy.example")
  assert.equal(
    JSON.stringify(calls),
    JSON.stringify([
      {
        command: "desktop_api",
        args: {
          operation: "servers.switchTo",
          args: ["https://alloy.example"],
        },
      },
      { command: "desktop_api", args: { operation: "servers.list", args: [] } },
      {
        command: "desktop_api",
        args: { operation: "servers.current", args: [] },
      },
      {
        command: "desktop_api",
        args: { operation: "servers.forget", args: ["https://alloy.example"] },
      },
    ]),
  )
})

test("native thumbnail calls carry bytes and subscriptions can stop before registration", async () => {
  const { window, calls, callbacks, completeListen } = loadBridge()
  assert.ok(window.alloyTauriDesktop)
  await window.alloyTauriDesktop.recording.saveLibraryCaptureThumbnail(
    "capture",
    new Uint8Array([255, 0, 12]),
  )
  assert.equal(
    JSON.stringify(calls[0]),
    JSON.stringify({
      command: "desktop_api",
      args: {
        operation: "recording.saveLibraryCaptureThumbnail",
        args: ["capture", [255, 0, 12]],
      },
    }),
  )
  let received = 0
  const stop = window.alloyTauriDesktop.recording.onEvent(() => {
    received++
  })
  callbacks.get(7)?.({ payload: { type: "test" } })
  assert.equal(received, 1)
  stop()
  callbacks.get(7)?.({ payload: { type: "test" } })
  assert.equal(received, 1)
  completeListen(31)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(callbacks.size, 0)
  assert.equal(
    JSON.stringify(calls.at(-1)),
    JSON.stringify({
      command: "plugin:event|unlisten",
      args: { event: "alloy:recording", eventId: 31 },
    }),
  )
  stop()
  assert.equal(calls.length, 3)
})
