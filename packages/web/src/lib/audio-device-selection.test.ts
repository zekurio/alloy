import assert from "node:assert/strict"

import type {
  RecordingAudioApplicationSelection,
  RecordingAudioDeviceSelection,
} from "@alloy/desktop-contracts"
import { test } from "vitest"

import { enabledAudioSourceCount } from "./audio-device-selection"

function device(
  kind: RecordingAudioDeviceSelection["kind"],
  enabled: boolean,
): RecordingAudioDeviceSelection {
  return {
    id: `${kind}-1`,
    label: kind,
    kind,
    enabled,
    volume: 100,
  }
}

function application(
  enabled: boolean,
  window = "window-1",
): RecordingAudioApplicationSelection {
  return {
    id: "application-1",
    name: "Application",
    window,
    executable: null,
    iconUrl: null,
    processId: null,
    enabled,
    volume: 100,
  }
}

test("counts enabled devices in devices mode", () => {
  assert.equal(
    enabledAudioSourceCount({
      audioMode: "devices",
      audioDevices: [device("output", true), device("input", false)],
      audioApplications: [],
    }),
    1,
  )
})

test("counts input devices and windowed applications in applications mode", () => {
  assert.equal(
    enabledAudioSourceCount({
      audioMode: "applications",
      audioDevices: [device("output", true), device("input", true)],
      audioApplications: [
        application(true),
        application(false),
        application(true, ""),
      ],
    }),
    2,
  )
})
