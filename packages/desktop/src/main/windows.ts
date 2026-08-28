import { join } from "node:path"

import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app, BrowserWindow, type Event, type WebContents } from "electron"

import {
  clearAppProtocolServer,
  selectAppProtocolServer,
  selectedAppProtocolServer,
} from "./app-protocol"
import { forwardRendererConsole } from "./logging"
import { hardenMainSessionPermissions, MAIN_PARTITION } from "./session"
import { isSelectedServerExternalUrl } from "./url-policy"
import {
  isTrustedMainRendererUrl,
  isTrustedOverlayRendererUrl,
  loadDesktopRenderer,
  loadRenderer,
  openDesktopPath,
  openExternal,
  showWindow,
} from "./window-navigation"

const logger = createLogger("windows")

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
const WINDOW_BACKGROUND_COLOR = "#171717"

/** Owns the bundled connect overlay and bundled main application window. */
export class Windows {
  private overlay: BrowserWindow | null = null
  private main: BrowserWindow | null = null
  private selectedServerUrl: string | null = null
  private isQuitting = false

  createOverlay(): BrowserWindow {
    const win = new BrowserWindow({
      width: 480,
      height: 600,
      icon: WINDOW_ICON,
      resizable: false,
      show: false,
      title: t("Alloy"),
      backgroundColor: WINDOW_BACKGROUND_COLOR,
      webPreferences: {
        preload: OVERLAY_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    win.once("ready-to-show", () => win.show())
    win.on("closed", () => {
      if (this.overlay === win) this.overlay = null
    })
    win.webContents.setWindowOpenHandler(() => {
      logger.warn("blocked external popup from the connect renderer")
      return { action: "deny" }
    })
    win.webContents.on("will-navigate", (event, url) => {
      this.handleOverlayNavigation(event, url)
    })
    win.webContents.on("will-redirect", (event, url) => {
      this.handleOverlayNavigation(event, url)
    })

    forwardRendererConsole(win.webContents)
    loadRenderer(win)
    this.overlay = win
    return win
  }

  /** Select a server before replacing the main document with the local app. */
  connectTo(serverUrl: string): void {
    // Destroy the old renderer before changing the process-wide proxy target.
    // Otherwise an in-flight request from server A could race onto server B.
    if (this.main && !this.main.isDestroyed()) this.main.destroy()

    selectAppProtocolServer(serverUrl)
    this.selectedServerUrl = selectedAppProtocolServer()
    hardenMainSessionPermissions()

    const win = this.ensureMain()
    void loadDesktopRenderer(win).catch((cause: unknown) => {
      logger.warn("failed to load bundled renderer:", cause)
    })
    win.show()
    win.focus()
    this.overlay?.close()
  }

  disconnectFromServer(): void {
    this.selectedServerUrl = null
    clearAppProtocolServer()
    if (this.main && !this.main.isDestroyed()) this.main.destroy()
    this.openConnect()
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
    if (!win || win.isDestroyed() || !this.selectedServerUrl) {
      if (!this.showPrimary()) this.openConnect()
      return
    }

    showWindow(win)
    void openDesktopPath(win, "/library")
  }

  canUseOverlayApi(sender: WebContents, frameUrl: string): boolean {
    return (
      BrowserWindow.fromWebContents(sender) === this.overlay &&
      isTrustedOverlayRendererUrl(frameUrl)
    )
  }

  canUseMainApi(sender: WebContents, frameUrl: string): boolean {
    return (
      BrowserWindow.fromWebContents(sender) === this.main &&
      isTrustedMainRendererUrl(frameUrl)
    )
  }

  canUseAppApi(sender: WebContents, frameUrl: string): boolean {
    return this.canUseMainApi(sender, frameUrl)
  }

  canUseDesktopApi(sender: WebContents, frameUrl: string): boolean {
    return (
      this.canUseOverlayApi(sender, frameUrl) ||
      this.canUseAppApi(sender, frameUrl)
    )
  }

  canUseDesktopServerStateApi(sender: WebContents, frameUrl: string): boolean {
    return this.canUseDesktopApi(sender, frameUrl)
  }

  currentServerUrl(): string | null {
    return this.selectedServerUrl
  }

  openSettings(): void {
    const win = this.main
    if (!win || win.isDestroyed() || !this.selectedServerUrl) {
      this.showPrimary()
      return
    }

    showWindow(win)
    void openDesktopPath(win, "/?settings=desktop")
  }

  showAndNavigate(path: string): void {
    if (!path.startsWith("/") || path.startsWith("//")) {
      this.showPrimary()
      return
    }
    const win = this.main
    if (!win || win.isDestroyed() || !this.selectedServerUrl) {
      this.showPrimary()
      return
    }
    showWindow(win)
    void openDesktopPath(win, path)
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
      title: t("Alloy"),
      backgroundColor: WINDOW_BACKGROUND_COLOR,
      webPreferences: {
        partition: MAIN_PARTITION,
        preload: MAIN_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (this.isSelectedServerUrl(url)) openExternal(url)
      else logger.warn("blocked non-server popup from the bundled renderer")
      return { action: "deny" }
    })

    forwardRendererConsole(win.webContents)
    win.webContents.on("will-navigate", (event, url) => {
      this.handleMainNavigation(event, url)
    })
    win.webContents.on("will-redirect", (event, url) => {
      this.handleMainNavigation(event, url)
    })

    win.on("close", (event) => {
      if (this.isQuitting) return
      event.preventDefault()
      win.hide()
    })
    win.on("closed", () => {
      if (this.main === win) this.main = null
    })

    this.main = win
    return win
  }

  private handleMainNavigation(event: Event, url: string): void {
    if (isTrustedMainRendererUrl(url)) return
    event.preventDefault()
    if (this.isSelectedServerUrl(url)) openExternal(url)
    else logger.warn("blocked non-server navigation from the bundled renderer")
  }

  private handleOverlayNavigation(event: Event, url: string): void {
    if (isTrustedOverlayRendererUrl(url)) return
    event.preventDefault()
    logger.warn("blocked navigation from the connect renderer")
  }

  private isSelectedServerUrl(url: string): boolean {
    return isSelectedServerExternalUrl(url, this.selectedServerUrl)
  }
}
