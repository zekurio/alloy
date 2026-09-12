import type {
  RecordingEvent,
  RecordingStatus,
  RecordingTelemetry,
  RecordingLibraryDownload,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import {
  finalizeRecordingCapture,
  statusWithCapture,
} from "./recording-capture-finalize"
import { rememberRecordingLibraryCapture } from "./recording-library"
import type { SidecarEvent } from "./recording-sidecar-client"
import { handleRecordingEventSound } from "./recording-sound-policy"
import { rememberRecordingStatus } from "./recording-status-state"
import { getRecordingSettings } from "./server-store"

const logger = createLogger("recording")

type RecordingEventListener = (event: RecordingEvent) => void
type RecordingClipHotkeyListener = () => void

const recordingEventListeners = new Set<RecordingEventListener>()
const recordingClipHotkeyListeners = new Set<RecordingClipHotkeyListener>()
const screenshotHotkeyListeners = new Set<RecordingClipHotkeyListener>()

export function onRecordingScreenshotHotkey(
  listener: RecordingClipHotkeyListener,
): () => void {
  screenshotHotkeyListeners.add(listener)
  return () => screenshotHotkeyListeners.delete(listener)
}

export function onRecordingEvent(listener: RecordingEventListener): () => void {
  recordingEventListeners.add(listener)
  return () => recordingEventListeners.delete(listener)
}

/** Native agent hotkeys stay inside the desktop shell, never the web app. */
export function onRecordingClipHotkey(
  listener: RecordingClipHotkeyListener,
): () => void {
  recordingClipHotkeyListeners.add(listener)
  return () => recordingClipHotkeyListeners.delete(listener)
}

export function emitRecordingSettingsEvent(): void {
  emitRecordingEvent({ type: "settings", settings: getRecordingSettings() })
}

export function emitRecordingStatusEvent(status: RecordingStatus): void {
  emitRecordingEvent({ type: "status", status })
}

/** Progress/terminal updates from the clip download manager. */
export function emitRecordingLibraryDownloadEvent(
  download: RecordingLibraryDownload,
): void {
  emitRecordingEvent({ type: "library-download", download })
}

export function emitRecordingEvent(event: SidecarEvent): void {
  if (event.type === "screenshot-hotkey") {
    for (const listener of screenshotHotkeyListeners) listener()
    return
  }
  if (event.type === "clip-hotkey") {
    for (const listener of recordingClipHotkeyListeners) listener()
    return
  }

  if (event.type === "telemetry") {
    logRecordingTelemetry(event.telemetry)
  } else if (event.type === "capture-ready" && event.status.telemetry) {
    logRecordingTelemetry(event.status.telemetry, "capture")
  }

  if (event.type === "capture-ready") {
    void emitFinalizedCaptureReady(event)
    return
  }
  if ("status" in event) rememberRecordingStatus(event.status)
  handleRecordingEventSound(event)
  sendRecordingEvent(event)
}

async function emitFinalizedCaptureReady(
  event: Extract<RecordingEvent, { type: "capture-ready" }>,
): Promise<void> {
  try {
    const capture = await finalizeRecordingCapture(event.capture)
    const finalized = {
      ...event,
      capture,
      status: statusWithCapture(event.status, capture),
    }
    rememberRecordingStatus(finalized.status)
    rememberRecordingLibraryCapture(capture)
    handleRecordingEventSound(finalized)
    sendRecordingEvent(finalized)
  } catch (cause) {
    logger.warn("failed to finalize recording capture:", cause)
  }
}

function sendRecordingEvent(event: RecordingEvent): void {
  for (const listener of recordingEventListeners) {
    listener(event)
  }
}

function logRecordingTelemetry(
  telemetry: RecordingTelemetry,
  reason = "sample",
): void {
  logger.info(
    "recorder telemetry",
    JSON.stringify({
      reason,
      sampledAt: telemetry.sampledAt,
      captureMode: telemetry.captureMode,
      source: telemetry.captureSource,
      storage: telemetry.bufferStorage,
      encoder: telemetry.encoder,
      codec: telemetry.codec,
      videoEncoder: telemetry.videoEncoder,
      audioEncoder: telemetry.audioEncoder,
      gpu: telemetry.gpu,
      gpuAdapter: telemetry.gpuAdapter,
      gpuLabel: telemetry.gpuLabel,
      dimensions: `${telemetry.outputWidth}x${telemetry.outputHeight}@${telemetry.fps}`,
      baseDimensions: `${telemetry.baseWidth}x${telemetry.baseHeight}`,
      bitrateKbps: telemetry.bitrateKbps,
      outputActive: telemetry.outputActive,
      paused: telemetry.paused,
      activeFps: telemetry.activeFps,
      averageFrameTimeMs: telemetry.averageFrameTimeMs,
      frameIntervalMs: telemetry.frameIntervalMs,
      render: {
        totalFrames: telemetry.renderTotalFrames,
        laggedFrames: telemetry.renderLaggedFrames,
        laggedPercent: telemetry.renderLaggedPercent,
      },
      output: {
        totalFrames: telemetry.outputTotalFrames,
        droppedFrames: telemetry.outputDroppedFrames,
        droppedPercent: telemetry.outputDroppedPercent,
        totalBytes: telemetry.outputTotalBytes,
      },
    }),
  )
}
