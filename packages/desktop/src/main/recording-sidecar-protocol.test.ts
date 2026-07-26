import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { SIDECAR_METHODS } from "./recording-sidecar-protocol"

/**
 * The Electron main process and the Rust sidecar agree on a newline-delimited
 * JSON protocol, and nothing but discipline keeps the two halves in step: the
 * recorder's build script skips on non-Windows, so no CI job on Linux can
 * compile the Rust side to compare it against this one.
 *
 * Reading the Rust source as text is the only check available that runs
 * everywhere. It is coarse, but it catches the failure that actually happens -
 * a method added to one side and forgotten on the other, which surfaces as a
 * silent "unknown method" at runtime on a user's machine.
 */
const runtimeRs = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../recorder/src/sidecar_runtime.rs",
  ),
  "utf8",
)

test("every sidecar method is dispatched by the Rust runtime", () => {
  const dispatched = new Set(
    [...runtimeRs.matchAll(/^\s*"([A-Za-z]+)" =>/gm)].map(([, name]) => name),
  )

  assert.deepEqual(
    [...SIDECAR_METHODS].sort(),
    [...dispatched].sort(),
    "SIDECAR_METHODS and the sidecar_runtime.rs match arms have diverged. " +
      "Adding a method to one side only makes the sidecar reject the call at " +
      "runtime.",
  )
})

test("the method extraction actually matches something", () => {
  // Guards the test above against silently passing if the Rust dispatch is
  // reshaped so the pattern stops matching and both sets read as empty.
  assert.ok(
    runtimeRs.length > 1000,
    "sidecar_runtime.rs did not load; the path is probably stale",
  )
  assert.ok(
    /^\s*"[A-Za-z]+" =>/m.test(runtimeRs),
    "no match arms found in sidecar_runtime.rs; the dispatch shape changed " +
      "and this test needs updating rather than deleting",
  )
})
