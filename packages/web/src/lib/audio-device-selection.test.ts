import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_RECORDING_SETTINGS,
  normalizeRecordingSettings,
  type RecordingAudioDeviceSelection,
} from "@alloy/contracts"

import {
  mergeAudioDevices,
  toggleAudioDevice,
  upsertAudioDevice,
} from "./audio-device-selection"

const selectedA: RecordingAudioDeviceSelection = {
  id: "a",
  label: "Headset",
  kind: "output",
  enabled: true,
  volume: 42,
}

test("merges availability and selection by exact kind and id", () => {
  const devices = mergeAudioDevices(
    [
      { id: "b", label: "Headset", kind: "output" },
      { id: "a", label: "Renamed headset", kind: "output" },
    ],
    [selectedA, { ...selectedA, id: "missing", enabled: false }],
  )

  assert.deepEqual(devices, [
    {
      id: "b",
      label: "Headset",
      kind: "output",
      enabled: false,
      volume: 100,
      available: true,
    },
    {
      id: "missing",
      label: "Headset",
      kind: "output",
      enabled: false,
      volume: 42,
      available: false,
    },
    {
      id: "a",
      label: "Renamed headset",
      kind: "output",
      enabled: true,
      volume: 42,
      available: true,
    },
  ])
})

test("sorts default first and same-label devices by full id", () => {
  assert.deepEqual(
    mergeAudioDevices(
      [
        { id: "z", label: "Same", kind: "output" },
        { id: "default", label: "Default output", kind: "output" },
        { id: "a", label: "Same", kind: "output" },
      ],
      [],
    ).map((device) => device.id),
    ["default", "a", "z"],
  )
})

test("toggle replaces an exact key in place and preserves its volume", () => {
  const other = { ...selectedA, id: "other" }
  assert.deepEqual(
    toggleAudioDevice([selectedA, other], {
      ...selectedA,
      label: "Updated label",
      enabled: false,
      volume: 100,
    }),
    [{ ...selectedA, label: "Updated label", enabled: false }, other],
  )
})

test("upsert keeps same-label ids independent and preserves ordering", () => {
  const other = { ...selectedA, id: "other" }
  const replacement = { ...selectedA, enabled: false }
  assert.deepEqual(upsertAudioDevice([other, selectedA], replacement), [
    other,
    replacement,
  ])
})

test("normalization migrates the input communications alias and dedupes it", () => {
  const settings = normalizeRecordingSettings({
    ...DEFAULT_RECORDING_SETTINGS,
    audioDevices: [
      { ...selectedA, id: "communications", kind: "input" },
      { ...selectedA, id: "default", kind: "input", enabled: false },
    ],
  })

  assert.deepEqual(settings.audioDevices, [
    {
      ...selectedA,
      id: "default",
      label: "Default microphone",
      kind: "input",
    },
  ])
})

test("normalization retains output communications only as disabled", () => {
  const settings = normalizeRecordingSettings({
    ...DEFAULT_RECORDING_SETTINGS,
    audioDevices: [{ ...selectedA, id: "communications" }],
  })

  assert.deepEqual(settings.audioDevices, [
    { ...selectedA, id: "communications", enabled: false },
  ])
})

test("normalization does not add default to a physical-only selection", () => {
  const settings = normalizeRecordingSettings({
    ...DEFAULT_RECORDING_SETTINGS,
    audioDevices: [selectedA],
  })

  assert.deepEqual(settings.audioDevices, [selectedA])
})
