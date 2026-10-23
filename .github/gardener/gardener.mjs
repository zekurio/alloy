#!/usr/bin/env node
// alloy-gardener: issue triage, PR review, changelog labels, and stale-thread
// locking.
//
// Runs from .github/workflows/gardener.yml on the base branch checkout only.
// It never checks out or executes pull request code: PR diffs and file
// contents are fetched through the GitHub API and treated as untrusted text.
//
// Usage: node .github/gardener/gardener.mjs <triage|review|changelog|lock> [number]

import { changelog, lock } from "./housekeeping.mjs"
import { review } from "./review.mjs"
import { env } from "./runtime.mjs"
import { triage } from "./triage.mjs"

const commands = { triage, review, changelog, lock }

const usage = (reason) => {
  process.stderr.write(
    `${reason}\nusage: gardener.mjs <triage|review|changelog> <number> | gardener.mjs lock\n`,
  )
  process.exit(2)
}

const [mode, arg] = process.argv.slice(2)
if (!commands[mode]) usage(`unknown command: ${mode ?? "(none)"}`)

// `Number("")` is 0, so require a plain positive integer string.
let number
if (mode !== "lock") {
  if (!/^[1-9][0-9]*$/.test(arg ?? "")) {
    usage(`${mode} needs a positive issue/PR number, got: "${arg ?? ""}"`)
  }
  number = Number(arg)
}

// Fail once, up front, instead of once per issue at the first model call.
if (mode === "triage" || mode === "review") env("ANTHROPIC_API_KEY")

await commands[mode](number)
