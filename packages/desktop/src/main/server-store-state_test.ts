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

test("normalizeState applies recording defaults", () => {
  const state = normalizeState({})

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
    state.recording.allowedGames.length === 0,
    "missing allowed games should use the default",
  )
  assert(
    state.recording.deniedGames.length === 0,
    "missing denied games should use the default",
  )
  assert(
    state.recording.hotkeys.saveClip ===
      DEFAULT_RECORDING_SETTINGS.hotkeys.saveClip,
    "missing save clip hotkey should use the default",
  )
  assert(
    state.recording.notificationSounds.recordingStarted.enabled === true,
    "missing recording start sound should be enabled by default",
  )
  assert(
    state.recording.notificationSounds.clipSaved.path === "",
    "missing clip save sound should use the bundled default",
  )
  assert(
    state.recording.notificationSounds.clipSaved.volume === 100,
    "missing clip save sound volume should use the default",
  )
})

test("normalizeState sanitizes recording settings", () => {
  const state = normalizeState({
    recording: {
      enabled: false,
      triggerMode: "session",
      encoder: "software",
      codec: "vp9",
      resolution: "1440p",
      fps: 59,
      replayBufferSeconds: 900,
      allowedGames: [
        {
          id: "hades",
          name: "Hades",
          executable: "Hades.exe",
          path: "C:\\Games\\Hades\\Hades.exe",
        },
      ],
      deniedGames: [
        {
          id: "launcher",
          name: "Launcher",
          executable: "Launcher.exe",
        },
      ],
      notificationSounds: {
        recordingStarted: {
          enabled: false,
          volume: -10,
          path: "C:\\Sounds\\start.wav",
        },
        clipSaved: {
          enabled: true,
          volume: 43.6,
          path: "C:\\Sounds\\clip.mp3",
        },
      },
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
    state.recording.enabled === false,
    "valid enabled toggle should remain",
  )
  assert(
    state.recording.triggerMode === "session",
    "valid trigger mode should remain",
  )
  assert(
    state.recording.allowedGames[0]?.name === "Hades",
    "valid allowed game should remain",
  )
  assert(
    state.recording.deniedGames[0]?.name === "Launcher",
    "valid denied game should remain",
  )
  assert(
    state.recording.notificationSounds.recordingStarted.enabled === false,
    "recording start sound mute should remain",
  )
  assert(
    state.recording.notificationSounds.recordingStarted.volume === 0,
    "recording start sound volume should be clamped",
  )
  assert(
    state.recording.notificationSounds.clipSaved.volume === 44,
    "clip save sound volume should be rounded",
  )
  assert(
    state.recording.notificationSounds.clipSaved.path ===
      "C:\\Sounds\\clip.mp3",
    "custom clip save sound should remain",
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
