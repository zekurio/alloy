import type { RecordingSettings } from "./desktop-recording-types"

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  enabled: false,
  captureMode: "game",
  selectedDisplayId: "",
  longRecording: {
    autoRecordGames: false,
  },
  allowedGames: [],
  deniedGames: [],
  audioMode: "devices",
  audioDevices: [
    {
      id: "default",
      label: "Default output",
      kind: "output",
      enabled: true,
      volume: 100,
    },
  ],
  audioApplications: [],
  encoder: "hardware",
  gpu: "auto",
  codec: "h264",
  qualityProfile: "custom",
  resolution: "1080p",
  fps: 60,
  bitrate: "auto",
  customQuality: {
    resolution: "1080p",
    fps: 60,
    bitrate: "auto",
  },
  replayBufferSeconds: 90,
  bufferStorage: "memory",
  outputFolder: "",
  hotkeys: {
    clip: "F8",
    bookmark: "F9",
    screenshot: "F7",
  },
  notificationSounds: {
    replayRecordingStarted: { enabled: true, volume: 100, path: "" },
    clipSaved: { enabled: true, volume: 100, path: "" },
    bookmarkAdded: { enabled: true, volume: 100, path: "" },
    screenshotTaken: { enabled: true, volume: 100, path: "" },
  },
}
