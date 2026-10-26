import { screen, type BrowserWindow } from "electron"

import { asError, log } from "./log"
import type { NativePreferences, WindowState } from "./native"

// Remembered window geometry: restored when a window opens, saved shortly
// after it is resized and once more before the app quits.

/** The size used until the user has resized a window once. */
const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 800,
  maximized: false,
}
/**
 * How long after the last resize the size is saved, so dragging a window
 * edge does not rewrite the preferences file every frame.
 */
const WINDOW_STATE_SAVE_DELAY_MS = 400
/** The smallest window the web app can lay out in. */
export const MIN_WINDOW_WIDTH = 800
export const MIN_WINDOW_HEIGHT = 600

/**
 * The size a new window opens with: the last saved size, clamped to the
 * primary display so a size saved on a larger display still fits.
 */
export function restoredWindowState(
  preferences: NativePreferences,
): WindowState {
  const saved = preferences.windowState() ?? DEFAULT_WINDOW_STATE
  const available = screen.getPrimaryDisplay().workAreaSize
  return preferences.clampWindowState({
    width: Math.min(saved.width, available.width),
    height: Math.min(saved.height, available.height),
    maximized: saved.maximized,
  })
}

/**
 * Saves a window's geometry. A maximized window keeps the last normal size,
 * for when it is restored, and a minimized one is skipped: minimizing must
 * not change the remembered size.
 */
function saveWindowState(
  window: BrowserWindow,
  preferences: NativePreferences,
): void {
  if (window.isDestroyed() || window.isMinimized()) return
  const previous = preferences.windowState() ?? DEFAULT_WINDOW_STATE
  const maximized = window.isMaximized()
  const [width = 0, height = 0] = maximized
    ? [previous.width, previous.height]
    : window.getContentSize()
  if (width === 0 || height === 0) return
  const state = preferences.clampWindowState({ width, height, maximized })
  if (
    state.width === previous.width &&
    state.height === previous.height &&
    state.maximized === previous.maximized
  ) {
    return
  }
  try {
    preferences.rememberWindowState(state)
  } catch (cause) {
    log.warn("Could not save the window size: %s", asError(cause))
  }
}

const pendingSaves = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>()

/** Saves the window's geometry after each burst of resizes. */
export function trackWindowState(
  window: BrowserWindow,
  preferences: NativePreferences,
): void {
  const queueSave = () => {
    const pending = pendingSaves.get(window)
    if (pending) clearTimeout(pending)
    pendingSaves.set(
      window,
      setTimeout(() => {
        pendingSaves.delete(window)
        saveWindowState(window, preferences)
      }, WINDOW_STATE_SAVE_DELAY_MS),
    )
  }
  window.on("resize", queueSave)
  window.on("maximize", queueSave)
  window.on("unmaximize", queueSave)
}

/** Saves every live window's geometry now, so quitting loses no resize. */
export function flushWindowState(
  windows: readonly (BrowserWindow | null | undefined)[],
  preferences: NativePreferences,
): void {
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue
    const pending = pendingSaves.get(window)
    if (pending) clearTimeout(pending)
    pendingSaves.delete(window)
    saveWindowState(window, preferences)
  }
}
