import { join } from "node:path"

import { createLogger } from "@alloy/logging"
import { shell, type BrowserWindow } from "electron"

import { sameOrigin } from "./url-policy"

const logger = createLogger("windows")

export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Script for a same-document navigation inside the remote app. The pushed
 * state must carry TanStack Router's history bookkeeping: the router derives
 * back/forward availability from the `__TSR_index` it stores on every entry,
 * and a plain `pushState({})` breaks that chain — each later in-app push then
 * computes `undefined + 1 = NaN`, leaving the header nav arrows disabled for
 * the rest of the session.
 */
function sameDocumentNavigationScript(mutateUrl: string): string {
  return `
    (() => {
      const url = new URL(window.location.href);
      ${mutateUrl}
      const prevIndex = window.history.state?.__TSR_index;
      const key = Math.random().toString(36).slice(2, 10);
      window.history.pushState(
        {
          key,
          __TSR_key: key,
          __TSR_index: Number.isInteger(prevIndex) ? prevIndex + 1 : 0,
        },
        "",
        url,
      );
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    })();
  `
}

export async function openWebSettings(
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
    sameDocumentNavigationScript(
      `url.searchParams.set("settings", "desktop");`,
    ),
    true,
  )
}

export async function openWebPath(
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
    sameDocumentNavigationScript(`
      url.pathname = ${JSON.stringify(targetUrl.pathname)};
      url.search = ${JSON.stringify(targetUrl.search)};
      url.hash = "";
    `),
    true,
  )
}

export function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    logger.warn("failed to open external URL:", error)
  })
}

/**
 * Load the overlay renderer: the electron-vite dev server in development, the
 * built HTML in production. `ELECTRON_RENDERER_URL` is injected by electron-vite
 * during `dev`.
 */
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
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) {
    win.loadFile(join(import.meta.dirname, "../renderer", html), {
      query: params,
    })
    return
  }

  const url = new URL(html, devUrl.endsWith("/") ? devUrl : `${devUrl}/`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  win.loadURL(url.toString())
}
