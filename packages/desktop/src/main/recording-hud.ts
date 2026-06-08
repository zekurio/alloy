import { join } from "node:path"

import { BrowserWindow, screen } from "electron"

import type { RecordingHudState } from "../shared/ipc"
import { IPC } from "../shared/ipc"

const HUD_WIDTH = 292
const HUD_HEIGHT = 68
const HUD_MARGIN_X = 24
const HUD_MARGIN_Y = 32
const SAVING_TIMEOUT_MS = 8000
const RESULT_TIMEOUT_MS = 1800
const HUD_PRELOAD = join(import.meta.dirname, "../preload/recording-hud.cjs")

let hudWindow: BrowserWindow | null = null
let latestState: RecordingHudState | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

export function showRecordingHud(state: RecordingHudState): void {
  latestState = state
  clearHideTimer()

  const win = ensureRecordingHudWindow()
  positionRecordingHud(win)
  sendHudState(win, state)

  if (!win.isVisible()) win.showInactive()
  win.setAlwaysOnTop(true, "screen-saver")

  hideTimer = setTimeout(
    hideRecordingHud,
    state.kind === "saving" ? SAVING_TIMEOUT_MS : RESULT_TIMEOUT_MS,
  )
}

export function hideRecordingHud(): void {
  clearHideTimer()
  latestState = null

  const win = hudWindow
  hudWindow = null
  if (!win || win.isDestroyed()) return
  sendHudState(win, null)
  win.destroy()
}

export function destroyRecordingHud(): void {
  clearHideTimer()
  latestState = null

  const win = hudWindow
  hudWindow = null
  if (win && !win.isDestroyed()) win.destroy()
}

function ensureRecordingHudWindow(): BrowserWindow {
  if (hudWindow && !hudWindow.isDestroyed()) return hudWindow

  const win = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: "Alloy Recording HUD",
    webPreferences: {
      preload: HUD_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, "screen-saver")
  win.on("closed", () => {
    hudWindow = null
  })
  win.webContents.once("did-finish-load", () => {
    if (latestState) sendHudState(win, latestState)
  })

  loadHudRenderer(win)
  hudWindow = win
  return win
}

function positionRecordingHud(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display =
    screen.getDisplayNearestPoint(cursor) ?? screen.getPrimaryDisplay()
  const area = display.workArea

  win.setBounds({
    x: Math.round(area.x + area.width - HUD_WIDTH - HUD_MARGIN_X),
    y: Math.round(area.y + HUD_MARGIN_Y),
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
  })
}

function sendHudState(
  win: BrowserWindow,
  state: RecordingHudState | null,
): void {
  if (win.webContents.isLoading()) return
  win.webContents.send(IPC.recordingHudState, state)
}

function loadHudRenderer(win: BrowserWindow): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    url.pathname = "/recording-hud.html"
    url.search = ""
    win.loadURL(url.toString())
    return
  }

  win.loadFile(join(import.meta.dirname, "../renderer/recording-hud.html"))
}

function clearHideTimer(): void {
  if (!hideTimer) return
  clearTimeout(hideTimer)
  hideTimer = null
}
