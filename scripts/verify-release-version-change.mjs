#!/usr/bin/env node

/* eslint-disable no-console */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const baseRef = process.argv[2]
const semverVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/

const versionFiles = [
  {
    path: "package.json",
    readVersion: (content) => JSON.parse(content).version,
  },
  {
    path: "packages/desktop/package.json",
    readVersion: (content) => JSON.parse(content).version,
  },
  {
    path: "packages/recorder/package.json",
    readVersion: (content) => JSON.parse(content).version,
  },
  {
    path: "packages/recorder/Cargo.toml",
    readVersion: readCargoPackageVersion,
  },
  {
    path: "packages/recorder/Cargo.lock",
    readVersion: readCargoLockVersion,
  },
]

if (!baseRef) {
  console.error(
    "Usage: node scripts/verify-release-version-change.mjs <base-ref>",
  )
  process.exit(1)
}

const currentVersion = readCurrentVersion("package.json", JSON.parse)
const baseVersion = readBaseVersion("package.json", JSON.parse)

assertPlainSemver("Current package.json version", currentVersion)
assertPlainSemver(`Base ${baseRef} package.json version`, baseVersion)

if (currentVersion === baseVersion) {
  console.error(
    `Release PRs from dev to main must change the stable semver. package.json is still ${currentVersion}.`,
  )
  process.exit(1)
}

const mismatches = versionFiles
  .map((file) => ({
    path: file.path,
    version: file.readVersion(readFileSync(file.path, "utf8")),
  }))
  .filter((file) => file.version !== currentVersion)

if (mismatches.length > 0) {
  console.error(
    `Release version files must all match package.json (${currentVersion}):`,
  )
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch.path}: ${mismatch.version}`)
  }
  process.exit(1)
}

console.log(`Release version changed from ${baseVersion} to ${currentVersion}.`)

function readCurrentVersion(filePath, parse) {
  return parse(readFileSync(filePath, "utf8")).version
}

function readBaseVersion(filePath, parse) {
  return parse(readBaseFile(filePath)).version
}

function readBaseFile(filePath) {
  try {
    return execFileSync("git", ["show", `${baseRef}:${filePath}`], {
      encoding: "utf8",
    })
  } catch (cause) {
    console.error(`Could not read ${filePath} from ${baseRef}.`)
    console.error(cause instanceof Error ? cause.message : cause)
    process.exit(1)
  }
}

function assertPlainSemver(label, version) {
  if (semverVersionPattern.test(String(version))) return

  console.error(`${label} must be plain semver (X.Y.Z), got: ${version}`)
  process.exit(1)
}

function readCargoPackageVersion(content) {
  const match = /^version = "([^"]+)"$/m.exec(content)
  if (!match) throw new Error("Cargo.toml is missing a package version.")
  return match[1]
}

function readCargoLockVersion(content) {
  const match =
    /\[\[package\]\]\nname = "alloy-recorder"\nversion = "([^"]+)"/.exec(
      content,
    )
  if (!match) throw new Error("Cargo.lock is missing alloy-recorder.")
  return match[1]
}
