#!/usr/bin/env node

/* eslint-disable no-console */

import { readFileSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
let version = null
let desktopChannel = null
let writeGithubOutput = false

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]

  if (arg === "--github-output") {
    writeGithubOutput = true
    continue
  }

  if (arg === "--desktop-channel") {
    desktopChannel = args[index + 1] ?? null
    index += 1
    continue
  }

  if (arg.startsWith("--")) {
    console.error(`Unknown option: ${arg}`)
    process.exit(1)
  }

  if (version) {
    console.error(`Unexpected argument: ${arg}`)
    process.exit(1)
  }

  version = arg
}

const releasePackageFiles = [
  "package.json",
  "packages/desktop/package.json",
  "packages/recorder/package.json",
]
const cargoPackageFiles = ["packages/recorder/Cargo.toml"]
const cargoLockPackageFiles = ["packages/recorder/Cargo.lock"]
const desktopUpdateChannelFiles = ["packages/desktop/assets/update-channel"]

if (!version) {
  console.error(
    "Usage: node scripts/update-release-package-versions.mjs <version> [--desktop-channel latest|unstable]",
  )
  process.exit(1)
}

const semverVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/
const unstableVersionPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+-unstable\.[0-9]{8}\.[0-9]+$/

if (
  !semverVersionPattern.test(version) &&
  !unstableVersionPattern.test(version)
) {
  console.error(`Invalid release version: ${version}`)
  process.exit(1)
}

if (desktopChannel && !/^(latest|unstable)$/.test(desktopChannel)) {
  console.error(`Invalid desktop release channel: ${desktopChannel}`)
  process.exit(1)
}

let changed = false

for (const filePath of releasePackageFiles) {
  const config = JSON.parse(readFileSync(filePath, "utf8"))

  let fileChanged = false

  if (config.version !== version) {
    config.version = version
    fileChanged = true
  }

  if (desktopChannel && filePath === "packages/desktop/package.json") {
    const publishConfig = config.build?.publish?.[0]

    if (!publishConfig || typeof publishConfig !== "object") {
      console.error(`${filePath} is missing build.publish[0].`)
      process.exit(1)
    }

    if (publishConfig.channel !== desktopChannel) {
      publishConfig.channel = desktopChannel
      fileChanged = true
    }

    const releaseType = desktopChannel === "unstable" ? "prerelease" : "release"

    if (publishConfig.releaseType !== releaseType) {
      publishConfig.releaseType = releaseType
      fileChanged = true
    }
  }

  if (fileChanged) {
    writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`)
    changed = true
  } else {
    console.log(
      `${filePath} is already at version ${version}${
        desktopChannel && filePath === "packages/desktop/package.json"
          ? ` for ${desktopChannel}`
          : ""
      }.`,
    )
  }
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

for (const filePath of cargoLockPackageFiles) {
  const original = readFileSync(filePath, "utf8")
  const updated = original.replace(
    /(\[\[package\]\]\nname = "alloy-recorder"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  )

  if (updated === original) {
    console.log(`${filePath} is already at version ${version}.`)
    continue
  }

  writeFileSync(filePath, updated)
  changed = true
}

if (desktopChannel) {
  for (const filePath of desktopUpdateChannelFiles) {
    const original = readFileSync(filePath, "utf8")
    const updated = `${desktopChannel}\n`

    if (updated === original) {
      console.log(`${filePath} is already set to ${desktopChannel}.`)
      continue
    }

    writeFileSync(filePath, updated)
    changed = true
  }
}

if (writeGithubOutput) {
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) {
    console.error("GITHUB_OUTPUT is not set.")
    process.exit(1)
  }
  writeFileSync(githubOutput, `changed=${changed}\n`, { flag: "a" })
}
