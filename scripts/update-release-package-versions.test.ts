import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { test } from "vitest"

const script = fileURLToPath(
  new URL("./update-release-package-versions.mjs", import.meta.url),
)

// Mirrors the checked-in files closely enough to catch the release bump
// rewriting something other than the version: oxfmt runs on `dev` before every
// release, so re-serializing the Tauri config would fail `pnpm fmt:check`.
const fixtures = {
  "package.json": `{
  "name": "alloy",
  "version": "0.0.4",
  "private": true
}
`,
  "packages/desktop/package.json": `{
  "name": "@alloy/desktop",
  "version": "0.0.4"
}
`,
  "packages/desktop/src-tauri/tauri.conf.json": `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Alloy",
  "version": "0.0.4",
  "app": {
    "security": {
      "capabilities": ["connect"]
    }
  },
  "bundle": {
    "targets": ["nsis"],
    "icon": ["icons/icon.ico", "../../../public/logo.png"]
  }
}
`,
  "packages/desktop/recorder/Cargo.toml": `[package]
name = "alloy-agent"
version = "0.0.4"
`,
  "packages/desktop/src-tauri/Cargo.toml": `[package]
name = "alloy-desktop"
version = "0.0.4"
`,
  "Cargo.lock": `[[package]]
name = "alloy-agent"
version = "0.0.4"

[[package]]
name = "alloy-desktop"
version = "0.0.4"

[[package]]
name = "serde"
version = "1.0.219"
`,
}

test("release bump only rewrites version fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "alloy-release-bump-"))
  try {
    for (const [filePath, contents] of Object.entries(fixtures)) {
      const target = join(root, filePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents)
    }

    const result = spawnSync(process.execPath, [script, "0.0.5"], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(result.status, 0, result.stderr)

    for (const [filePath, contents] of Object.entries(fixtures)) {
      assert.equal(
        await readFile(join(root, filePath), "utf8"),
        contents.replaceAll("0.0.4", "0.0.5"),
        filePath,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
