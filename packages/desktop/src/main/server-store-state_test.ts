import { test } from "node:test"

import { DEFAULT_RECORDING_SETTINGS } from "alloy-contracts"

import {
  MAX_SAVED_SERVERS,
  normalizeState,
  upsertServer,
} from "./server-store-state"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("normalizeState migrates legacy lastServerUrl into saved servers", () => {
  const state = normalizeState({ lastServerUrl: "https://alloy.example.com" })

  assert(
    state.servers[0]?.serverUrl === "https://alloy.example.com",
    "legacy last server should become the first saved server",
  )
  assert(
    state.lastServerUrl === "https://alloy.example.com",
    "legacy last server should remain available",
  )
  assert(
    state.recording.codec === DEFAULT_RECORDING_SETTINGS.codec,
    "missing recording codec should use the default",
  )
  assert(
    state.recording.replayBufferSeconds ===
      DEFAULT_RECORDING_SETTINGS.replayBufferSeconds,
    "missing replay buffer length should use the default",
  )
  assert(
    state.recording.qualityProfile ===
      DEFAULT_RECORDING_SETTINGS.qualityProfile,
    "missing quality profile should use the default",
  )
  assert(
    state.recording.customQuality.bitrate ===
      DEFAULT_RECORDING_SETTINGS.customQuality.bitrate,
    "missing custom quality should use the default",
  )
  assert(
    state.recording.triggerMode === DEFAULT_RECORDING_SETTINGS.triggerMode,
    "missing trigger mode should use the default",
  )
  assert(
    state.recording.enabled === DEFAULT_RECORDING_SETTINGS.enabled,
    "missing recording enabled toggle should use the default",
  )
  assert(
    state.recording.recordDesktop === DEFAULT_RECORDING_SETTINGS.recordDesktop,
    "missing desktop capture policy should use the default",
  )
  assert(
    state.recording.hotkeys.saveClip ===
      DEFAULT_RECORDING_SETTINGS.hotkeys.saveClip,
    "missing save clip hotkey should use the default",
  )
})

test("normalizeState sanitizes recording settings", () => {
  const state = normalizeState({
    recording: {
      enabled: false,
      triggerMode: "session",
      recordDesktop: true,
      encoder: "software",
      codec: "vp9",
      resolution: "1440p",
      fps: 59,
      replayBufferSeconds: 900,
      autoCategorizeGames: false,
    },
  })

  assert(state.recording.encoder === "software", "valid encoder should remain")
  assert(
    state.recording.codec === DEFAULT_RECORDING_SETTINGS.codec,
    "invalid codec should fall back",
  )
  assert(
    state.recording.resolution === "1440p",
    "valid resolution should remain",
  )
  assert(
    state.recording.fps === DEFAULT_RECORDING_SETTINGS.fps,
    "invalid fps should fall back",
  )
  assert(
    state.recording.qualityProfile === "custom",
    "unmatched quality settings should select custom",
  )
  assert(
    state.recording.customQuality.resolution === "1440p",
    "missing custom quality should seed from active quality",
  )
  assert(
    state.recording.replayBufferSeconds === 600,
    "replay buffer should be capped",
  )
  assert(
    state.recording.autoCategorizeGames === false,
    "valid game categorization toggle should remain",
  )
  assert(
    state.recording.enabled === false,
    "valid enabled toggle should remain",
  )
  assert(
    state.recording.triggerMode === "replay-buffer",
    "desktop capture should force replay buffer mode",
  )
  assert(
    state.recording.recordDesktop === true,
    "valid desktop capture policy should remain",
  )
})

test("normalizeState migrates manual recording settings to replay clips", () => {
  const state = normalizeState({
    recording: {
      triggerMode: "manual",
      hotkeys: {
        startCapture: "Ctrl+F9",
        stopCapture: "Ctrl+F10",
        saveClip: "Ctrl+F8",
      },
    },
  })

  assert(
    state.recording.triggerMode === "replay-buffer",
    "legacy manual mode should become replay buffer mode",
  )
  assert(
    state.recording.hotkeys.saveClip === "Ctrl+F8",
    "custom save clip hotkey should be preserved",
  )
  assert(
    !("startCapture" in state.recording.hotkeys),
    "legacy start hotkey should be discarded",
  )
  assert(
    !("stopCapture" in state.recording.hotkeys),
    "legacy stop hotkey should be discarded",
  )
})

test("normalizeState infers preset profiles from legacy recording quality", () => {
  const state = normalizeState({
    recording: {
      resolution: "1080p",
      fps: 60,
      bitrate: "15",
    },
  })

  assert(
    state.recording.qualityProfile === "standard",
    "legacy quality matching a preset should select that preset",
  )
})

test("normalizeState keeps custom quality separate from the active preset", () => {
  const state = normalizeState({
    recording: {
      qualityProfile: "high",
      resolution: "1440p",
      fps: 60,
      bitrate: "30",
      customQuality: {
        resolution: "2160p",
        fps: 120,
        bitrate: "50",
      },
    },
  })

  assert(state.recording.qualityProfile === "high", "active preset should stay")
  assert(
    state.recording.resolution === "1440p",
    "active preset resolution should stay",
  )
  assert(
    state.recording.customQuality.resolution === "2160p",
    "custom resolution should remain independent",
  )
  assert(
    state.recording.customQuality.fps === 120,
    "custom FPS should remain independent",
  )
  assert(
    state.recording.customQuality.bitrate === "50",
    "custom bitrate should remain independent",
  )
})

test("upsertServer moves existing server to the top", () => {
  const first = "https://first.example.com"
  const second = "https://second.example.com"
  const servers = upsertServer(
    [
      { serverUrl: first, lastConnectedAt: "2026-01-01T00:00:00.000Z" },
      { serverUrl: second, lastConnectedAt: "2026-01-02T00:00:00.000Z" },
    ],
    second,
    new Date("2026-01-03T00:00:00.000Z"),
  )

  assert(servers[0]?.serverUrl === second, "existing server should move first")
  assert(
    servers[0]?.lastConnectedAt === "2026-01-03T00:00:00.000Z",
    "existing server timestamp should update",
  )
  assert(servers.length === 2, "existing server should not duplicate")
})

test("upsertServer caps the saved server list", () => {
  const seed = Array.from({ length: MAX_SAVED_SERVERS }, (_, index) => ({
    serverUrl: `https://${index}.example.com`,
    lastConnectedAt: "2026-01-01T00:00:00.000Z",
  }))

  const servers = upsertServer(
    seed,
    "https://new.example.com",
    new Date("2026-01-02T00:00:00.000Z"),
  )

  assert(servers.length === MAX_SAVED_SERVERS, "saved list should stay capped")
  assert(
    servers[0]?.serverUrl === "https://new.example.com",
    "new server should be first",
  )
  assert(
    !servers.some((server) => server.serverUrl === "https://7.example.com"),
    "oldest server should be dropped",
  )
})
