import assert from "node:assert/strict"
import test from "node:test"

import type { StartupUpdateState } from "@/shared/ipc"

import {
  runInteractiveStartupUpdate,
  type StartupUpdateCheck,
  type StartupUpdateChoice,
  withStartupDeadline,
} from "./startup-update"

function driver(options: {
  checks: StartupUpdateCheck[]
  choices?: StartupUpdateChoice[]
  downloadError?: Error
  installError?: Error
}) {
  const states: StartupUpdateState[] = []
  const calls: string[] = []
  return {
    states,
    calls,
    value: {
      currentVersion: "1.0.0",
      check: async () => {
        calls.push("check")
        return options.checks.shift() ?? { kind: "current" as const }
      },
      download: async (version: string) => {
        calls.push(`download:${version}`)
        if (options.downloadError) throw options.downloadError
      },
      install: async () => {
        calls.push("install")
        if (options.installError) throw options.installError
      },
      publish: (state: StartupUpdateState) => states.push(state),
      choose: async (autoContinueMs: number | null) => {
        calls.push(`choose:${autoContinueMs ?? "manual"}`)
        return options.choices?.shift() ?? "continue"
      },
    },
  }
}

test("continues at once when the installed version is current", async () => {
  const testDriver = driver({ checks: [{ kind: "current" }] })

  assert.equal(await runInteractiveStartupUpdate(testDriver.value), "continue")
  assert.deepEqual(testDriver.calls, ["check"])
  assert.deepEqual(
    testDriver.states.map((state) => state.phase),
    ["checking"],
  )
})

test("downloads and installs an update before startup", async () => {
  const testDriver = driver({
    checks: [{ kind: "available", version: "1.1.0" }],
  })

  assert.equal(
    await runInteractiveStartupUpdate(testDriver.value),
    "installing",
  )
  assert.deepEqual(testDriver.calls, ["check", "download:1.1.0", "install"])
  assert.deepEqual(
    testDriver.states.map((state) => state.phase),
    ["checking", "downloading", "installing"],
  )
})

test("an offline check has a short automatic continue path", async () => {
  const testDriver = driver({
    checks: [{ kind: "unavailable", message: "No network" }],
  })

  assert.equal(await runInteractiveStartupUpdate(testDriver.value), "continue")
  assert.deepEqual(testDriver.calls, ["check", "choose:1500"])
  assert.equal(testDriver.states.at(-1)?.phase, "error")
})

test("a failed download can retry the full check", async () => {
  const testDriver = driver({
    checks: [{ kind: "available", version: "1.1.0" }, { kind: "current" }],
    choices: ["retry"],
    downloadError: new Error("Download failed"),
  })

  assert.equal(await runInteractiveStartupUpdate(testDriver.value), "continue")
  assert.deepEqual(testDriver.calls, [
    "check",
    "download:1.1.0",
    "choose:30000",
    "check",
  ])
})

test("a stalled startup operation reaches its deadline", async () => {
  await assert.rejects(
    withStartupDeadline(new Promise(() => undefined), 5, "Timed out"),
    /Timed out/,
  )
})

test("a failed installer has a finite continue path", async () => {
  const testDriver = driver({
    checks: [{ kind: "available", version: "1.1.0" }],
    installError: new Error("Installer failed"),
  })

  assert.equal(await runInteractiveStartupUpdate(testDriver.value), "continue")
  assert.deepEqual(testDriver.calls, [
    "check",
    "download:1.1.0",
    "install",
    "choose:30000",
  ])
})
