#!/usr/bin/env node

/* eslint-disable no-console */

import { readFileSync, writeFileSync } from "node:fs"

const version = process.argv[2]

const releasePackageFiles = [
  "package.json",
  "packages/desktop/package.json",
  "packages/desktop/src-tauri/tauri.conf.json",
]
const cargoPackageFiles = [
  ["packages/desktop/recorder/Cargo.toml", "alloy-agent"],
  ["packages/desktop/src-tauri/Cargo.toml", "alloy-desktop"],
]
const cargoLockPackageFiles = [
  ["Cargo.lock", "alloy-agent"],
  ["Cargo.lock", "alloy-desktop"],
]

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

if (!version || process.argv.length > 3) {
  fail("Usage: node scripts/update-release-package-versions.mjs <version>")
}

if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  fail(`Invalid release version: ${version}`)
}

for (const filePath of releasePackageFiles) {
  const original = readFileSync(filePath, "utf8")
  const config = JSON.parse(original)

  if (config.version === version) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  // Patch the version value in place instead of re-serializing the document:
  // `JSON.stringify` expands arrays that oxfmt keeps inline in the Tauri
  // config, which would leave the release commit failing `pnpm fmt:check`.
  const updated = original.replace(
    /^ {2}"version": "[^"]+"(,?)$/m,
    `  "version": "${version}"$1`,
  )

  if (updated === original) {
    fail(`No top-level "version" field found in ${filePath}.`)
  }

  writeFileSync(filePath, updated)
}

for (const [filePath, packageName] of cargoPackageFiles) {
  const original = readFileSync(filePath, "utf8")
  // Only touch the `[package]` table, and only when it is the expected crate
  // with a literal version (not `version.workspace = true`).
  const packageTable = original.match(
    /^\[package\]\n(?:(?!\[)[^\n]*\n?)*/m,
  )?.[0]
  if (!packageTable?.includes(`\nname = "${packageName}"\n`)) {
    fail(`${filePath} has no [package] named "${packageName}".`)
  }
  const versionLine = /^version = "([^"]+)"$/m
  const current = packageTable.match(versionLine)?.[1]
  if (current === undefined) {
    fail(
      `No literal [package] version found for "${packageName}" in ${filePath}.`,
    )
  }
  if (current === version) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  writeFileSync(
    filePath,
    original.replace(
      packageTable,
      packageTable.replace(versionLine, `version = "${version}"`),
    ),
  )
}

for (const [filePath, packageName] of cargoLockPackageFiles) {
  const original = readFileSync(filePath, "utf8")
  const entry = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")([^"]+)(")`,
  )
  const current = original.match(entry)?.[2]
  if (current === undefined) {
    fail(`No Cargo.lock entry found for "${packageName}" in ${filePath}.`)
  }
  if (current === version) {
    console.log(
      `${filePath} (${packageName}) is already at version ${version}.`,
    )
    continue
  }

  writeFileSync(filePath, original.replace(entry, `$1${version}$3`))
}
