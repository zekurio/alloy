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
export const WINDOW_ICON = app.isPackaged
  ? join(process.resourcesPath, "assets", "icon.png")
  : join(import.meta.dirname, "../../assets/icon.png")

const MAIN_WINDOW_WIDTH = 1280
const MAIN_WINDOW_HEIGHT = 800
const MAIN_WINDOW_MIN_WIDTH = 1024
const MAIN_WINDOW_MIN_HEIGHT = 700

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
  private staleMainOrigin: string | null = null
  private staleMainOriginTimer: ReturnType<typeof setTimeout> | null = null
  private isQuitting = false

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
    const nextOrigin = new URL(serverUrl).origin
    const previousOrigin = this.mainOrigin
    if (
      previousOrigin &&
      previousOrigin !== nextOrigin &&
      this.main &&
      !this.main.isDestroyed()
    ) {
      this.allowStaleMainOrigin(previousOrigin)
    }

    this.mainOrigin = nextOrigin
    hardenMainSessionPermissions()
    const win = this.ensureMain()
    void win
      .loadURL(serverUrl)
      .catch((error: unknown) => {
        logger.warn("[desktop] failed to load server URL:", error)
      })
      .finally(() => {
        if (previousOrigin) this.clearStaleMainOrigin(previousOrigin)
      })
    win.show()
    win.focus()
    this.overlay?.close()
  }

  openConnect(): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      showWindow(this.overlay)
      return
    }

    this.createOverlay()
  }

  openLibrary(): void {
    const win = this.main
    const origin = this.mainOrigin
    if (!win || win.isDestroyed() || !origin) {
      if (!this.showPrimary()) this.openConnect()
      return
    }

    showWindow(win)
    void openWebPath(win, origin, "/library")
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

  canUseAppBridge(sender: WebContents, frameUrl: string): boolean {
    return this.canUseMainBridge(sender, frameUrl)
  }

  canUseDesktopBridge(sender: WebContents, frameUrl: string): boolean {
    return (
      this.canUseOverlayBridge(sender) || this.canUseAppBridge(sender, frameUrl)
    )
  }

  canUseDesktopServerStateBridge(
    sender: WebContents,
    frameUrl: string,
  ): boolean {
    return (
      this.canUseDesktopBridge(sender, frameUrl) ||
      this.canUseStaleMainBridge(sender, frameUrl)
    )
  }

  currentServerUrl(): string | null {
    return this.mainOrigin
  }

  openSettings(): void {
    const win = this.main
    const origin = this.mainOrigin
    if (!win || win.isDestroyed() || !origin) {
      this.showPrimary()
      return
    }

    showWindow(win)
    void openWebSettings(win, origin)
  }

  showPrimary(): boolean {
    const win = this.main ?? this.overlay
    if (!win || win.isDestroyed()) return false

    showWindow(win)
    return true
  }

  allowAppQuit(): void {
    this.isQuitting = true
  }

  private ensureMain(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main

    const win = new BrowserWindow({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      useContentSize: true,
      frame: false,
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

    win.on("close", (event) => {
      if (this.isQuitting) return

      event.preventDefault()
      win.hide()
    })
    win.on("closed", () => {
      this.main = null
      this.clearStaleMainOrigin()
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

  private canUseStaleMainBridge(
    sender: WebContents,
    frameUrl: string,
  ): boolean {
    const origin = this.staleMainOrigin
    return (
      BrowserWindow.fromWebContents(sender) === this.main &&
      origin !== null &&
      sameOrigin(frameUrl, origin)
    )
  }

  private allowStaleMainOrigin(origin: string): void {
    this.staleMainOrigin = origin
    if (this.staleMainOriginTimer) clearTimeout(this.staleMainOriginTimer)
    this.staleMainOriginTimer = setTimeout(() => {
      this.clearStaleMainOrigin(origin)
    }, 10_000)
  }

  private clearStaleMainOrigin(origin?: string): void {
    if (origin && this.staleMainOrigin !== origin) return
    this.staleMainOrigin = null
    if (this.staleMainOriginTimer) {
      clearTimeout(this.staleMainOriginTimer)
      this.staleMainOriginTimer = null
    }
  }
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function openWebSettings(
  win: BrowserWindow,
  origin: string,
): Promise<void> {
  const settingsUrl = new URL(origin)
  settingsUrl.searchParams.set("settings", "desktop")

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", () => {
      void openWebSettings(win, origin)
    })
    return
  }

  const currentUrl = win.webContents.getURL()
  if (!sameOrigin(currentUrl, origin)) {
    await win.loadURL(settingsUrl.toString())
    return
  }

  await win.webContents.executeJavaScript(
    `
      (() => {
        const url = new URL(window.location.href);
        url.searchParams.set("settings", "desktop");
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      })();
    `,
    true,
  )
}

async function openWebPath(
  win: BrowserWindow,
  origin: string,
  path: string,
): Promise<void> {
  const targetUrl = new URL(path, origin)

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", () => {
      void openWebPath(win, origin, path)
    })
    return
  }

  const currentUrl = win.webContents.getURL()
  if (!sameOrigin(currentUrl, origin)) {
    await win.loadURL(targetUrl.toString())
    return
  }

  await win.webContents.executeJavaScript(
    `
      (() => {
        const url = new URL(window.location.href);
        url.pathname = ${JSON.stringify(targetUrl.pathname)};
        url.search = ${JSON.stringify(targetUrl.search)};
        url.hash = "";
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      })();
    `,
    true,
  )
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
  html = "index.html",
): void {
  const params = Object.fromEntries(
    Object.entries(query ?? {}).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl.endsWith("/") ? devUrl : `${devUrl}/`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer", html), {
      query: params,
    })
  }
}
