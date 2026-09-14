#!/usr/bin/env node

/* eslint-disable no-console */

import { readFileSync, writeFileSync } from "node:fs"

const version = process.argv[2]

const releasePackageFiles = [
  "package.json",
  "packages/desktop/package.json",
  "packages/desktop/src-tauri/tauri.conf.json",
  "packages/recorder/package.json",
]
const cargoPackageFiles = [
  "packages/recorder/Cargo.toml",
  "packages/desktop/src-tauri/Cargo.toml",
]
const cargoLockPackageFiles = [
  ["Cargo.lock", "alloy-agent"],
  ["Cargo.lock", "alloy-desktop"],
]

if (!version || process.argv.length > 3) {
  console.error(
    "Usage: node scripts/update-release-package-versions.mjs <version>",
  )
  process.exit(1)
}

if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  console.error(`Invalid release version: ${version}`)
  process.exit(1)
}

for (const filePath of releasePackageFiles) {
  const config = JSON.parse(readFileSync(filePath, "utf8"))

  if (config.version === version) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  config.version = version
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`)
}

for (const filePath of cargoPackageFiles) {
  const original = readFileSync(filePath, "utf8")
  const updated = original.replace(
    /^version = ".*"$/m,
    `version = "${version}"`,
  )

  if (updated === original) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  writeFileSync(filePath, updated)
}

for (const [filePath, packageName] of cargoLockPackageFiles) {
  const original = readFileSync(filePath, "utf8")
  const updated = original.replace(
    new RegExp(
      `(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")[^"]+(")`,
    ),
    `$1${version}$2`,
  )

  if (updated === original) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  writeFileSync(filePath, updated)
}
