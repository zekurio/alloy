import type { RecordingSettings } from "alloy-contracts"
import { logger } from "alloy-logging"
import { app, globalShortcut } from "electron"

import {
  cancelReplaySaveRequestedSoundSuppression,
  playReplaySaveRequestedSound,
  saveReplayClip,
} from "./recording"
import { electronAccelerator } from "./recording-hotkey-accelerator"
import { getRecordingSettings } from "./server-store"

const HOTKEY_HEALTH_INTERVAL_MS = 30_000
const SAVE_CLIP_HOTKEY_DEBOUNCE_MS = 2_000

const registeredAccelerators = new Set<string>()
let pendingReadyRegistration = false
let pendingSettings: RecordingSettings | null = null
let activeSettings: RecordingSettings | null = null
let activeAccelerator: string | null = null
let healthTimer: ReturnType<typeof setInterval> | null = null
let saveClipHotkeyInFlight = false
let lastSaveClipHotkeyAt = 0

export function configureRecordingHotkeys(
  settings: RecordingSettings = getRecordingSettings(),
): void {
  if (!app.isReady()) {
    pendingSettings = settings
    if (!pendingReadyRegistration) {
      pendingReadyRegistration = true
      void configurePendingHotkeysWhenReady()
    }
    return
  }

  unregisterRecordingHotkeys()
  activeSettings = settings

  const accelerator = electronAccelerator(settings.hotkeys.saveClip)
  if (!accelerator) {
    if (settings.hotkeys.saveClip.trim().length > 0) {
      logger.warn(
        `[desktop] invalid recording hotkey: ${settings.hotkeys.saveClip}`,
      )
    }
    return
  }

  if (!registerSaveClipAccelerator(accelerator)) {
    logger.warn(`[desktop] failed to register hotkey: ${accelerator}`)
    return
  }

  activeAccelerator = accelerator
  startHotkeyHealthCheck()
}

export function unregisterRecordingHotkeys(): void {
  pendingSettings = null
  activeSettings = null
  activeAccelerator = null
  stopHotkeyHealthCheck()
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator)
  }
  registeredAccelerators.clear()
}

async function runSaveClipHotkey(): Promise<void> {
  const now = Date.now()
  if (now - lastSaveClipHotkeyAt < SAVE_CLIP_HOTKEY_DEBOUNCE_MS) return
  if (saveClipHotkeyInFlight) return

  lastSaveClipHotkeyAt = now
  saveClipHotkeyInFlight = true
  const playedRequestSound = playReplaySaveRequestedSound()

  try {
    const result = await saveReplayClip()
    if (!result.ok) {
      if (playedRequestSound) cancelReplaySaveRequestedSoundSuppression()
      logger.warn(`[desktop] recording hotkey failed: ${result.error}`)
    } else if (!result.capture && playedRequestSound) {
      cancelReplaySaveRequestedSoundSuppression()
    }
  } finally {
    saveClipHotkeyInFlight = false
  }
}

function registerSaveClipAccelerator(accelerator: string): boolean {
  let registered = false
  try {
    registered = globalShortcut.register(
      accelerator,
      () => void runSaveClipHotkey(),
    )
  } catch (cause) {
    logger.warn(`[desktop] failed to register hotkey: ${accelerator}`, cause)
  }

  if (!registered || !globalShortcut.isRegistered(accelerator)) return false
  registeredAccelerators.add(accelerator)
  logger.info(`[desktop] recording hotkey registered: ${accelerator}`)
  return true
}

function startHotkeyHealthCheck(): void {
  if (healthTimer) return
  healthTimer = setInterval(checkHotkeyRegistration, HOTKEY_HEALTH_INTERVAL_MS)
  healthTimer.unref?.()
}

function stopHotkeyHealthCheck(): void {
  if (!healthTimer) return
  clearInterval(healthTimer)
  healthTimer = null
}

function checkHotkeyRegistration(): void {
  const accelerator = activeAccelerator
  const settings = activeSettings
  if (!accelerator || !settings) return

  if (
    registeredAccelerators.has(accelerator) &&
    globalShortcut.isRegistered(accelerator)
  ) {
    return
  }

  registeredAccelerators.delete(accelerator)
  logger.warn(
    `[desktop] recording hotkey was no longer registered; retrying: ${settings.hotkeys.saveClip}`,
  )
  if (registerSaveClipAccelerator(accelerator)) return

  logger.warn(`[desktop] recording hotkey recovery failed: ${accelerator}`)
}

async function configurePendingHotkeysWhenReady(): Promise<void> {
  await app.whenReady()
  pendingReadyRegistration = false
  const next = pendingSettings
  pendingSettings = null
  if (next) configureRecordingHotkeys(next)
}
