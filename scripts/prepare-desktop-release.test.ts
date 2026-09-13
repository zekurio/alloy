import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { test } from "vite-plus/test"

test("desktop release metadata points to the exact signed installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "alloy-release-"))
  const source = join(
    root,
    "packages/desktop-tauri/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
  )
  const output = join(root, "packages/desktop-tauri/release")
  const script = fileURLToPath(
    new URL("./prepare-desktop-release.mjs", import.meta.url),
  )
  try {
    await mkdir(source, { recursive: true })
    await writeFile(
      join(source, "Alloy_2.3.4_x64-setup.exe"),
      "installer bytes",
    )
    const unsigned = spawnSync(process.execPath, [script, "2.3.4"], {
      cwd: root,
    })
    assert.notEqual(unsigned.status, 0)
    await writeFile(
      join(source, "Alloy_2.3.4_x64-setup.exe.sig"),
      "signed fixture\n",
    )
    const signed = spawnSync(process.execPath, [script, "2.3.4"], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(signed.status, 0, signed.stderr)
    assert.equal(
      await readFile(
        join(output, "Alloy-Desktop-2.3.4-win-x64-setup.exe"),
        "utf8",
      ),
      "installer bytes",
    )
    assert.equal(
      await readFile(
        join(output, "Alloy-Desktop-2.3.4-win-x64-setup.exe.sig"),
        "utf8",
      ),
      "signed fixture\n",
    )
    const metadata = JSON.parse(
      await readFile(join(output, "latest.json"), "utf8"),
    )
    assert.ok(Number.isFinite(Date.parse(metadata.pub_date)))
    assert.deepEqual(metadata, {
      version: "2.3.4",
      pub_date: metadata.pub_date,
      platforms: {
        "windows-x86_64": {
          signature: "signed fixture",
          url: "https://github.com/zekurio/alloy/releases/download/v2.3.4/Alloy-Desktop-2.3.4-win-x64-setup.exe",
        },
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
