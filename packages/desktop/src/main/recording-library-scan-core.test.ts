import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { test } from "vite-plus/test"

import { createRecordingLibrarySnapshot } from "./recording-library-scan-core"

test("scans screenshots and clips together while ignoring incomplete captures", () => {
  const outputFolder = mkdtempSync(join(tmpdir(), "alloy-media-scan-"))
  try {
    for (const [collection, files] of [
      [
        "Screenshots",
        ["one.PNG", "two.jpg", "three.webp", "partial.png.tmp", "wrong.mp4"],
      ],
      ["Clips", ["replay.mp4", "wrong.png"]],
    ] as const) {
      const folder = join(outputFolder, collection, "Test game")
      mkdirSync(folder, { recursive: true })
      for (const name of files) writeFileSync(join(folder, name), "capture")
    }
    const snapshot = createRecordingLibrarySnapshot({
      outputFolder,
      manifest: { version: 2, captures: {} },
      thumbnailBlurHashes: {},
    })
    assert.equal(snapshot.totalCount, 4)
    assert.equal(
      snapshot.items.filter((item) => item.kind === "screenshot").length,
      3,
    )
    assert.equal(snapshot.groups.length, 1)
    assert.equal(snapshot.groups[0].clipCount, 1)
    assert.ok(snapshot.items.every((item) => item.gameName === "Test game"))
  } finally {
    rmSync(outputFolder, { recursive: true, force: true })
  }
})
