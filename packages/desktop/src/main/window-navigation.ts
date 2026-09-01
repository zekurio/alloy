import { pathToFileURL } from "node:url"

import { createLogger } from "@alloy/logging"
import { app, shell, type BrowserWindow } from "electron"

import { isTrustedDesktopOrigin } from "../shared/desktop-origin"
import { rendererFile } from "./renderer-files"
import { selectedServerPathUrl } from "./url-policy"

const logger = createLogger("windows")
const OVERLAY_DOCUMENT = rendererFile(app.getAppPath(), "index.html")

export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function loadServerRenderer(
  win: BrowserWindow,
  serverOrigin: string,
  path: string,
): Promise<void> {
  const target = selectedServerPathUrl(serverOrigin, path)
  return target ? win.loadURL(target) : Promise.resolve()
}

export const isTrustedMainRendererUrl = isTrustedDesktopOrigin

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
    win.loadFile(rendererFile(app.getAppPath(), html), {
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
