import assert from "node:assert/strict"
import { test } from "node:test"

import { DESKTOP_BRIDGE, DESKTOP_BRIDGE_VERSION } from "./desktop-bridge"

/**
 * The desktop shell and the server-hosted web app update independently, so the
 * bridge contract is additive-only. Two mistakes break real installs and
 * neither is expressible in the type system:
 *
 * - Removing a path breaks web builds still calling it from an older desktop.
 * - Giving a new path an already-released `since` makes `desktopBridgeSupports`
 *   report support on a desktop that never implemented it, so the call rejects
 *   as an unknown channel.
 *
 * SHIPPED is the frozen record of paths already released. It does not need
 * manual upkeep between releases: entries at the in-flight version are allowed
 * to be absent, and the "released paths are recorded" test below forces them in
 * as soon as DESKTOP_BRIDGE_VERSION moves past them.
 */
const SHIPPED: Record<string, number> = {
  minimizeWindow: 1,
  toggleMaximizeWindow: 1,
  closeWindow: 1,
  openConnect: 1,
  openSettings: 1,
  reloadApp: 1,
  "servers.connect": 1,
  "servers.getServers": 1,
  "servers.getCurrentServer": 1,
  "servers.forgetServer": 1,
  "recording.getSettings": 1,
  "recording.setSettings": 1,
  "recording.restartBackend": 1,
  "recording.getStatus": 1,
  "recording.getStorageInfo": 1,
  "recording.getLibrary": 1,
  "recording.revealLibraryCapture": 1,
  "recording.exportLibraryCapture": 1,
  "recording.updateLibraryCapture": 1,
  "recording.setLibraryCaptureTrim": 2,
  "recording.deleteLibraryCapture": 1,
  "recording.importLibraryFiles": 1,
  "recording.commitStagedLibraryImport": 1,
  "recording.discardStagedLibraryImport": 1,
  "recording.saveLibraryCaptureThumbnail": 1,
  "recording.downloadClip": 1,
  "recording.cancelClipDownload": 1,
  "recording.listClipDownloads": 1,
  "recording.onEvent": 1,
  "recording.selectOutputFolder": 1,
  "recording.listGameProcesses": 1,
  "recording.listDisplays": 1,
  "recording.subscribeAudioLevels": 1,
  "recording.stopAudioLevels": 1,
  "recording.listNotificationSounds": 1,
  "recording.openNotificationSoundsFolder": 1,
  "recording.previewNotificationSound": 1,
  "updates.getState": 1,
  "updates.checkForUpdates": 1,
  "updates.downloadUpdate": 1,
  "updates.restartToInstall": 1,
  "updates.onState": 1,
  "autostart.getState": 1,
  "autostart.setEnabled": 1,
  "notifications.show": 1,
}

const current = bridgePaths()

test("released bridge paths are never removed or renumbered", () => {
  for (const [path, since] of Object.entries(SHIPPED)) {
    assert.equal(
      current.get(path),
      since,
      `${path} was released at bridge version ${since}. Removing it or ` +
        `changing its "since" breaks desktops and web builds already using it.`,
    )
  }
})

test("new bridge paths target the in-flight version", () => {
  for (const [path, since] of current) {
    if (path in SHIPPED) continue
    assert.equal(
      since,
      DESKTOP_BRIDGE_VERSION,
      `${path} is new, so its "since" must be the current ` +
        `DESKTOP_BRIDGE_VERSION (${DESKTOP_BRIDGE_VERSION}). A lower value ` +
        `makes an already-released desktop claim support for it.`,
    )
  }
})

test("released bridge paths are recorded in SHIPPED", () => {
  for (const [path, since] of current) {
    if (since >= DESKTOP_BRIDGE_VERSION) continue
    assert.ok(
      path in SHIPPED,
      `${path} (since ${since}) predates DESKTOP_BRIDGE_VERSION ` +
        `${DESKTOP_BRIDGE_VERSION}, so it has shipped and belongs in SHIPPED. ` +
        `Add it there when bumping the bridge version.`,
    )
  }
})

test("every since is a version that exists", () => {
  for (const [path, since] of current) {
    assert.ok(
      Number.isInteger(since) && since >= 1 && since <= DESKTOP_BRIDGE_VERSION,
      `${path} has since=${since}, outside 1..${DESKTOP_BRIDGE_VERSION}. A ` +
        `"since" above the contract version can never be satisfied.`,
    )
  }
})

/** Flattens the contract to dot-joined paths, mirroring the IPC channel names. */
function bridgePaths(): Map<string, number> {
  const paths = new Map<string, number>()
  const walk = (node: object, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== "object" || value === null) continue
      const path = prefix ? `${prefix}.${key}` : key
      if ("since" in value && typeof value.since === "number") {
        paths.set(path, value.since)
        continue
      }
      walk(value, path)
    }
  }
  walk(DESKTOP_BRIDGE, "")
  return paths
}
