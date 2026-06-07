import { join } from "node:path"

import { logger } from "alloy-logging"
import {
  app,
  BrowserWindow,
  shell,
  type Event as ElectronEvent,
  type WebContents,
} from "electron"

import { hardenMainSessionPermissions, MAIN_PARTITION } from "./session"
import { canOpenExternally, sameOrigin } from "./url-policy"

/** Resolved at runtime from the built output layout (see electron.vite.config). */
const OVERLAY_PRELOAD = join(import.meta.dirname, "../preload/overlay.cjs")
const MAIN_PRELOAD = join(import.meta.dirname, "../preload/main.cjs")
const WINDOW_ICON = app.isPackaged
  ? join(process.resourcesPath, "assets", "icon.png")
  : join(import.meta.dirname, "../../assets/icon.png")

/**
 * Owns the two window surfaces:
 *  - `overlay`: trusted, bundled connect screen; the only window granted the
 *    privileged `window.alloyNative` bridge via its preload.
 *  - `main`: loads the remote server origin with a narrow desktop bridge used
 *    by the normal in-app settings dialog.
 */
export class Windows {
  private overlay: BrowserWindow | null = null
  private main: BrowserWindow | null = null
  private mainOrigin: string | null = null

  createOverlay(): BrowserWindow {
    const win = new BrowserWindow({
      width: 480,
      height: 600,
      icon: WINDOW_ICON,
      resizable: false,
      show: false,
      title: "Alloy",
      webPreferences: {
        preload: OVERLAY_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    win.once("ready-to-show", () => win.show())
    win.on("closed", () => {
      this.overlay = null
    })

    loadRenderer(win)
    this.overlay = win
    return win
  }

  /**
   * Navigate the main window to the chosen server origin, creating it on first
   * use, then hand the screen over from the overlay to the app.
   */
  connectTo(serverUrl: string): void {
    this.mainOrigin = new URL(serverUrl).origin
    hardenMainSessionPermissions()
    const win = this.ensureMain()
    win.loadURL(serverUrl)
    win.show()
    win.focus()
    this.overlay?.close()
  }

  canUseOverlayBridge(sender: WebContents): boolean {
    return BrowserWindow.fromWebContents(sender) === this.overlay
  }

  canUseMainBridge(sender: WebContents, frameUrl: string): boolean {
    const origin = this.mainOrigin
    return (
      BrowserWindow.fromWebContents(sender) === this.main &&
      origin !== null &&
      sameOrigin(frameUrl, origin)
    )
  }

  canUseDesktopBridge(sender: WebContents, frameUrl: string): boolean {
    return (
      this.canUseOverlayBridge(sender) ||
      this.canUseMainBridge(sender, frameUrl)
    )
  }

  private ensureMain(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      icon: WINDOW_ICON,
      show: false,
      title: "Alloy",
      webPreferences: {
        partition: MAIN_PARTITION,
        preload: MAIN_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    // Keep requested popup windows in the user's real browser, but only for
    // normal web URLs. Never pass file/custom/javascript protocols from remote
    // content to the OS shell.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (canOpenExternally(url)) openExternal(url)
      return { action: "deny" }
    })

    win.webContents.on("will-navigate", (event, url) => {
      this.handleNavigation(event, url)
    })
    win.webContents.on("will-redirect", (event, url) => {
      this.handleNavigation(event, url)
    })

    win.on("closed", () => {
      this.main = null
    })

    this.main = win
    return win
  }

  private handleNavigation(event: ElectronEvent, url: string): void {
    const origin = this.mainOrigin
    if (origin && sameOrigin(url, origin)) return

    event.preventDefault()
    if (canOpenExternally(url)) openExternal(url)
  }
}

function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    logger.warn("[desktop] failed to open external URL:", error)
  })
}

/**
 * Load the overlay renderer: the electron-vite dev server in development, the
 * built HTML in production. `ELECTRON_RENDERER_URL` is injected by electron-vite
 * during `dev`.
 */
function loadRenderer(
  win: BrowserWindow,
  query?: Record<string, string | undefined>,
): void {
  const params = Object.fromEntries(
    Object.entries(query ?? {}).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"), {
      query: params,
    })
  }
}
