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
  "packages/desktop/recorder/Cargo.toml",
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
    console.error(`No top-level "version" field found in ${filePath}.`)
    process.exit(1)
  }

  writeFileSync(filePath, updated)
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
