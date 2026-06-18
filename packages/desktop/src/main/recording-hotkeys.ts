import type { RecordingSettings } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app, globalShortcut } from "electron"

import {
  addRecordingBookmark,
  cancelReplaySaveRequestedSoundSuppression,
  playReplaySaveRequestedSound,
  saveReplayClip,
  takeRecordingScreenshot,
} from "./recording"
import { electronAccelerator } from "./recording-hotkey-accelerator"
import { getRecordingSettings } from "./server-store"

const logger = createLogger("hotkeys")

type HotkeyAction =
  | { type: "clip"; durationSeconds: number }
  | { type: "bookmark" }
  | { type: "screenshot" }

const HOTKEY_HEALTH_INTERVAL_MS = 30_000
const HOTKEY_ACTION_DEBOUNCE_MS = 700

const registeredAccelerators = new Set<string>()
let pendingReadyRegistration = false
let pendingSettings: RecordingSettings | null = null
let activeSettings: RecordingSettings | null = null
let activeActions = new Map<string, HotkeyAction[]>()
let healthTimer: ReturnType<typeof setInterval> | null = null
let actionInFlight = new Set<string>()
let lastActionAt = new Map<string, number>()

export function configureRecordingHotkeys(
  settings: RecordingSettings = getRecordingSettings(),
): void {
  if (!settings.enabled) {
    unregisterRecordingHotkeys()
    return
  }

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
  activeActions = hotkeyActionMap(settings)

  for (const accelerator of activeActions.keys()) {
    if (!registerAccelerator(accelerator)) {
      logger.warn(`failed to register hotkey: ${accelerator}`)
    }
  }

  if (registeredAccelerators.size > 0) startHotkeyHealthCheck()
}

export function unregisterRecordingHotkeys(): void {
  pendingSettings = null
  activeSettings = null
  activeActions = new Map()
  actionInFlight = new Set()
  lastActionAt = new Map()
  stopHotkeyHealthCheck()
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator)
  }
  registeredAccelerators.clear()
}

async function runHotkeyActions(accelerator: string): Promise<void> {
  const actions = activeActions.get(accelerator) ?? []
  const requestedAtUnixMs = Date.now()

  await Promise.all(
    actions.map((action) =>
      runDebouncedAction(accelerator, action, requestedAtUnixMs),
    ),
  )
}

async function runDebouncedAction(
  accelerator: string,
  action: HotkeyAction,
  requestedAtUnixMs: number,
): Promise<void> {
  const key = actionKey(accelerator, action)
  const now = Date.now()
  if (now - (lastActionAt.get(key) ?? 0) < HOTKEY_ACTION_DEBOUNCE_MS) return
  if (actionInFlight.has(key)) return

  lastActionAt.set(key, now)
  actionInFlight.add(key)
  try {
    await runAction(action, requestedAtUnixMs)
  } finally {
    actionInFlight.delete(key)
  }
}

async function runAction(
  action: HotkeyAction,
  requestedAtUnixMs: number,
): Promise<void> {
  switch (action.type) {
    case "clip": {
      const playedRequestSound = playReplaySaveRequestedSound()
      const result = await saveReplayClip({
        requestedAtUnixMs,
        durationSeconds: action.durationSeconds,
      })
      if (!result.ok) {
        if (playedRequestSound) cancelReplaySaveRequestedSoundSuppression()
        logger.warn(`recording clip hotkey failed: ${result.error}`)
      } else if (!result.capture && playedRequestSound) {
        cancelReplaySaveRequestedSoundSuppression()
      }
      return
    }
    case "bookmark": {
      const result = await addRecordingBookmark({ requestedAtUnixMs })
      if (!result.ok) {
        logger.warn(`recording bookmark hotkey failed: ${result.error}`)
      }
      return
    }
    case "screenshot": {
      const result = await takeRecordingScreenshot({ requestedAtUnixMs })
      if (!result.ok) {
        logger.warn(`recording screenshot hotkey failed: ${result.error}`)
      }
      return
    }
  }
}

function registerAccelerator(accelerator: string): boolean {
  let registered = false
  try {
    registered = globalShortcut.register(
      accelerator,
      () => void runHotkeyActions(accelerator),
    )
  } catch (cause) {
    logger.warn(`failed to register hotkey: ${accelerator}`, cause)
  }

  if (!registered || !globalShortcut.isRegistered(accelerator)) return false
  registeredAccelerators.add(accelerator)
  logger.info(`recording hotkey registered: ${accelerator}`)
  return true
}

function hotkeyActionMap(
  settings: RecordingSettings,
): Map<string, HotkeyAction[]> {
  const actions = new Map<string, HotkeyAction[]>()
  const add = (hotkey: string, action: HotkeyAction) => {
    const accelerator = electronAccelerator(hotkey)
    if (!accelerator) {
      if (hotkey.trim().length > 0) {
        logger.warn(`invalid recording hotkey: ${hotkey}`)
      }
      return
    }
    actions.set(accelerator, [...(actions.get(accelerator) ?? []), action])
  }

  add(settings.hotkeys.clip, {
    type: "clip",
    durationSeconds: settings.replayBufferSeconds,
  })
  add(settings.hotkeys.bookmark, { type: "bookmark" })
  add(settings.hotkeys.screenshot, { type: "screenshot" })

  return actions
}

function actionKey(accelerator: string, action: HotkeyAction): string {
  return action.type === "clip"
    ? `${accelerator}:clip:${action.durationSeconds}`
    : `${accelerator}:${action.type}`
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
  const settings = activeSettings
  if (!settings) return

  for (const accelerator of activeActions.keys()) {
    if (
      registeredAccelerators.has(accelerator) &&
      globalShortcut.isRegistered(accelerator)
    ) {
      continue
    }

    registeredAccelerators.delete(accelerator)
    logger.warn(
      `recording hotkey was no longer registered; retrying: ${accelerator}`,
    )
    if (registerAccelerator(accelerator)) continue

    logger.warn(`recording hotkey recovery failed: ${accelerator}`)
  }
}

async function configurePendingHotkeysWhenReady(): Promise<void> {
  await app.whenReady()
  pendingReadyRegistration = false
  const next = pendingSettings
  pendingSettings = null
  if (next) configureRecordingHotkeys(next)
}
