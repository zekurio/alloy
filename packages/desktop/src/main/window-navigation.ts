import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createLogger } from "@alloy/logging"
import { app, shell, type BrowserWindow } from "electron"

import { APP_URL, isTrustedAppDocumentUrl } from "./app-protocol-policy"
import { desktopNavigationScript } from "./desktop-navigation"

const logger = createLogger("windows")
const OVERLAY_DOCUMENT = join(import.meta.dirname, "../renderer/index.html")

export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function loadDesktopRenderer(win: BrowserWindow): Promise<void> {
  return win.loadURL(desktopRendererUrl())
}

export async function openDesktopPath(
  win: BrowserWindow,
  path: string,
): Promise<void> {
  if (!isInternalAppPath(path)) return

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", () => {
      void openDesktopPath(win, path)
    })
    return
  }

  if (!isTrustedMainRendererUrl(win.webContents.getURL())) {
    await win.loadURL(desktopRendererUrl(path))
    return
  }

  await win.webContents.executeJavaScript(desktopNavigationScript(path), true)
}

export function desktopRendererUrl(path?: string): string {
  const devUrl = devRendererDocumentUrl("desktop.html")
  const base = devUrl ?? APP_URL
  if (!path || !isInternalAppPath(path)) return base
  const url = new URL(base)
  url.hash = path
  return url.toString()
}

export function isTrustedMainRendererUrl(rawUrl: string): boolean {
  return isTrustedAppDocumentUrl(rawUrl, devRendererDocumentUrl("desktop.html"))
}

export function isTrustedOverlayRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const devUrl = devRendererDocumentUrl("index.html")
    if (devUrl) {
      const expected = new URL(devUrl)
      return (
        url.origin === expected.origin && url.pathname === expected.pathname
      )
    }

    const expected = new URL(pathToFileURL(OVERLAY_DOCUMENT))
    return url.protocol === "file:" && url.pathname === expected.pathname
  } catch {
    return false
  }
}

export function openExternal(url: string): void {
  void shell.openExternal(url).catch((cause: unknown) => {
    logger.warn("failed to open external URL:", cause)
  })
}

/** Load the overlay from Electron Vite in development and disk when built. */
export function loadRenderer(
  win: BrowserWindow,
  query?: Record<string, string | undefined>,
  html = "index.html",
): void {
  const params = Object.fromEntries(
    Object.entries(query ?? {}).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
  const devUrl = devRendererDocumentUrl(html)
  if (!devUrl) {
    win.loadFile(join(import.meta.dirname, "../renderer", html), {
      query: params,
    })
    return
  }

  const url = new URL(devUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  win.loadURL(url.toString())
}

function devRendererDocumentUrl(html: string): string | null {
  if (app.isPackaged) return null
  const rawUrl = process.env.ELECTRON_RENDERER_URL
  if (!rawUrl) return null
  try {
    return new URL(
      html,
      rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`,
    ).toString()
  } catch {
    return null
  }
}

function isInternalAppPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//")
}
