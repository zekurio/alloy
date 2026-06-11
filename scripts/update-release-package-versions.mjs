#!/usr/bin/env node

/* eslint-disable no-console */

import { readFileSync, writeFileSync } from "node:fs"

const version = process.argv[2]
const writeGithubOutput = process.argv.includes("--github-output")
const releasePackageFiles = [
  "package.json",
  "packages/desktop/package.json",
  "packages/recorder/package.json",
]
const cargoPackageFiles = ["packages/recorder/Cargo.toml"]

if (!version) {
  console.error(
    "Usage: node scripts/update-release-package-versions.mjs <version>",
  )
  process.exit(1)
}

if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(version)) {
  console.error(`Invalid release version: ${version}`)
  process.exit(1)
}

let changed = false

for (const filePath of releasePackageFiles) {
  const config = JSON.parse(readFileSync(filePath, "utf8"))

  if (config.version === version) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  config.version = version
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`)
  changed = true
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
  changed = true
}

if (writeGithubOutput) {
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) {
    console.error("GITHUB_OUTPUT is not set.")
    process.exit(1)
  }
  writeFileSync(githubOutput, `changed=${changed}\n`, { flag: "a" })
}
