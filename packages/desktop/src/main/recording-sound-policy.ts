import type {
  RecordingCapture,
  RecordingEvent,
  RecordingNotificationSoundEvent,
  RecordingStatus,
} from "alloy-contracts"

import { playRecordingNotificationSound } from "./recording-notification-sounds"
import { getRecordingSettings } from "./server-store"

/**
 * Decides when recording notification sounds play. Owns the dedupe and
 * suppression state so the recording orchestration layer only reports what
 * happened (events, statuses) and never reasons about chimes itself.
 */

let lastRecordingStartSoundKey: string | null = null
let lastClipSavedSoundKey: string | null = null
let pendingReplaySaveRequestSounds = 0
let startSoundSuppressionDepth = 0

export function playNotificationSound(
  sound: RecordingNotificationSoundEvent,
): void {
  const sounds = getRecordingSettings().notificationSounds
  void playRecordingNotificationSound(sound, sounds[sound])
}

/** Play whatever sound a sidecar event calls for (start chime, clip saved). */
export function handleRecordingEventSound(event: RecordingEvent): void {
  if (event.type === "game-ended") {
    lastRecordingStartSoundKey = null
  }
  maybePlayRecordingStartedSound(event)
  if (event.type === "capture-ready") {
    maybePlayClipSavedSound(event.capture)
  }
}

/**
 * Run `task` with the recording-started sound suppressed. Used while pushing
 * settings to the sidecar: a reconfigure restarts an active replay buffer and
 * would otherwise replay the start chime.
 */
export async function withRecordingStartSoundSuppressed<T>(
  suppress: boolean,
  task: () => Promise<T>,
): Promise<T> {
  if (!suppress) return task()

  startSoundSuppressionDepth += 1
  try {
    return await task()
  } finally {
    startSoundSuppressionDepth -= 1
  }
}

/**
 * Play the clip-saved sound immediately when a replay save is requested (so
 * the user hears feedback before the file lands) and suppress the duplicate
 * sound for the capture that follows.
 */
export function requestReplaySaveSound(
  status: RecordingStatus | null,
): boolean {
  if (!canReplayBufferSaveFromStatus(status)) return false

  pendingReplaySaveRequestSounds += 1
  playClipSavedSound(
    `requested:${Date.now()}:${pendingReplaySaveRequestSounds}`,
  )
  return true
}

export function cancelReplaySaveRequestedSoundSuppression(): void {
  if (pendingReplaySaveRequestSounds > 0) pendingReplaySaveRequestSounds -= 1
}

function maybePlayRecordingStartedSound(event: RecordingEvent): void {
  if (event.type !== "recording-started") return

  const soundKey = recordingStartSoundKey(event.status)
  if (!soundKey) return
  if (lastRecordingStartSoundKey === soundKey) return
  lastRecordingStartSoundKey = soundKey
  if (startSoundSuppressionDepth > 0) return

  playNotificationSound("recordingStarted")
}

function recordingStartSoundKey(status: RecordingStatus): string | null {
  if (status.backend !== "ready" || !status.replayActive) return null

  const targetKey = recordingTargetKey(status)
  return targetKey ? `replay:${targetKey}` : null
}

function recordingTargetKey(status: RecordingStatus): string | null {
  if (status.captureMode === "display") {
    return status.activeDisplay
      ? ["display", status.activeDisplay.id].join(":")
      : null
  }

  const game = status.activeGameDetail
  if (!game && !status.activeGame) return null

  const stableGameId =
    game?.id ??
    game?.executable ??
    game?.path ??
    game?.windowClass ??
    status.activeGame ??
    game?.name

  return [
    "game",
    stableGameId,
    game?.executable ?? "",
    game?.path ?? "",
    game?.windowClass ?? "",
    game?.name ?? status.activeGame ?? "",
  ].join(":")
}

function maybePlayClipSavedSound(capture: RecordingCapture): void {
  if (capture.kind !== "replay") return

  const soundKey = capture.id || capture.filename
  if (pendingReplaySaveRequestSounds > 0) {
    pendingReplaySaveRequestSounds -= 1
    lastClipSavedSoundKey = soundKey
    return
  }

  playClipSavedSound(soundKey)
}

function playClipSavedSound(soundKey: string): void {
  if (lastClipSavedSoundKey === soundKey) return
  lastClipSavedSoundKey = soundKey

  playNotificationSound("clipSaved")
}

function canReplayBufferSaveFromStatus(
  status: RecordingStatus | null,
): boolean {
  return (
    status?.backend === "ready" &&
    status.replayActive &&
    status.runState !== "error"
  )
}
