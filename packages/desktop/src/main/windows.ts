import { join } from "node:path"

import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app, BrowserWindow, type Event, type WebContents } from "electron"

import { desktopOriginArgument } from "../shared/desktop-origin"
import { clearAssetCacheServer, selectAssetCacheServer } from "./asset-cache"
import { forwardRendererConsole } from "./logging"
import { hardenMainSessionPermissions, MAIN_PARTITION } from "./session"
import { isSafeExternalUrl, normalizeServerOrigin } from "./url-policy"
import {
  isTrustedMainRendererUrl,
  isTrustedOverlayRendererUrl,
  loadServerRenderer,
  loadRenderer,
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

/** Owns the local connect overlay and server-hosted main application window. */
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

  /** Select a server before loading its web application into the main window. */
  connectTo(serverUrl: string): void {
    if (this.main && !this.main.isDestroyed()) this.main.destroy()

    const serverOrigin = normalizeServerOrigin(serverUrl)
    if (!serverOrigin) throw new Error("Invalid desktop server origin")
    this.selectedServerUrl = serverOrigin
    selectAssetCacheServer(serverOrigin)
    hardenMainSessionPermissions(serverOrigin)

    const win = this.ensureMain(serverOrigin)
    void loadServerRenderer(win, serverOrigin, "/")
      .then(() => {
        if (win.isDestroyed() || this.main !== win) return
        showWindow(win)
        this.overlay?.close()
      })
      .catch((cause: unknown) => {
        logger.warn("failed to load server renderer:", cause)
        if (!win.isDestroyed()) win.destroy()
        if (this.main === win) this.main = null
        if (this.selectedServerUrl === serverOrigin) {
          this.selectedServerUrl = null
          clearAssetCacheServer()
        }
        this.openConnect()
      })
  }

  disconnectFromServer(): void {
    this.selectedServerUrl = null
    clearAssetCacheServer()
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
    void loadServerRenderer(win, this.selectedServerUrl, "/library")
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
      isTrustedMainRendererUrl(frameUrl, this.selectedServerUrl)
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
    void loadServerRenderer(win, this.selectedServerUrl, "/?settings=desktop")
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
    void loadServerRenderer(win, this.selectedServerUrl, path)
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

  private ensureMain(serverOrigin: string): BrowserWindow {
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
        additionalArguments: [desktopOriginArgument(serverOrigin)],
      },
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) openExternal(url)
      else logger.warn("blocked unsafe popup from the server renderer")
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
    if (isTrustedMainRendererUrl(url, this.selectedServerUrl)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) openExternal(url)
    else logger.warn("blocked unsafe navigation from the server renderer")
  }

  private handleOverlayNavigation(event: Event, url: string): void {
    if (isTrustedOverlayRendererUrl(url)) return
    event.preventDefault()
    logger.warn("blocked navigation from the connect renderer")
  }
}
