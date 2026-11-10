#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"

// Stamps a release version into every file that holds it. Each edit replaces
// one known line in place, as re-serializing a file would change formatting
// that `pnpm fmt:check` checks.

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || process.argv.length > 3) {
  console.error("Usage: node scripts/update-release-package-versions.mjs X.Y.Z")
  process.exit(1)
}

const jsonVersion = /^( {2}"version": )"[^"]*"/m
const edits = [
  // The server and the web app report this version, and Nix packages it.
  ["package.json", jsonVersion],
  // The app version electron-builder stamps into the installer and
  // electron-updater compares against.
  ["packages/desktop/package.json", jsonVersion],
  // The crates the app ships inherit it, and Cargo.lock records each one.
  ["Cargo.toml", /^(\[workspace\.package\]\nversion = )"[^"]*"/m],
  ...["alloy-agent", "alloy-desktop", "alloy-desktop-native"].map((name) => [
    "Cargo.lock",
    new RegExp(`^(name = "${name}"\\nversion = )"[^"]*"`, "m"),
  ]),
]

for (const [file, line] of edits) {
  const text = readFileSync(file, "utf8")
  if (!line.test(text)) {
    console.error(`${file} has no line matching ${line}.`)
    process.exit(1)
  }
  writeFileSync(file, text.replace(line, `$1"${version}"`))
}
