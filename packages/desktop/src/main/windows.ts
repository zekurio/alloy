import { join } from "node:path"

import {
  app,
  BrowserWindow,
  Menu,
  session,
  shell,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron"

import { SELECTED_ORIGIN_ARGUMENT } from "../shared/ipc"
import { watchSessionCookies } from "./cookies"
import { connectPagePath, isConnectPageUrl, type Host } from "./host"
import { asError, log } from "./log"
import { appIconPath } from "./paths"
import { isExternalWebUrl, isSameOrigin, serverPartition } from "./policy"
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  restoredWindowState,
  trackWindowState,
} from "./window-state"

/**
 * Painted behind every window until the page renders, so windows never
 * flash white while the app loads. Matches the dark app background
 * (`--background`, `oklch(0.11 0 0)`).
 */
const WINDOW_BACKGROUND = "#040404"
/**
 * If the connect screen never reports that it rendered, show it anyway so a
 * broken bundle does not look like the app silently doing nothing.
 */
const CONNECT_SHOW_FALLBACK_MS = 3000
/**
 * Permissions the server's web app may use: fullscreen video, copying links
 * after an await (where the user gesture has expired), and reading local
 * media from the loopback capture server.
 */
const SERVER_PERMISSIONS = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
  "local-network-access",
  "loopback-network",
])

const PRELOAD_DIR = join(import.meta.dirname, "..", "preload")

/** Windows that open maximized once they are first shown. */
const maximizeOnShow = new WeakSet<BrowserWindow>()

export function showWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (maximizeOnShow.delete(window)) window.maximize()
  window.show()
  // A hidden window ignores `restore`, so it comes after `show`.
  if (window.isMinimized()) window.restore()
  window.focus()
}

/** Hands a link the shell will not open itself to the user's browser. */
export function openExternal(url: string): void {
  if (!isExternalWebUrl(url)) return
  shell.openExternal(url).catch((cause: Error) => {
    log.warn("Could not open a link in the browser. %s", cause)
  })
}

/**
 * Cut, copy, paste and select all for text, which Chromium leaves to the
 * embedder.
 */
function showEditMenu(window: BrowserWindow, params: ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = []
  if (params.isEditable) {
    items.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    )
  } else if (params.selectionText.trim()) {
    items.push({ role: "copy" })
  }
  if (items.length > 0) Menu.buildFromTemplate(items).popup({ window })
}

function denyAllPermissions(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  target.setPermissionCheckHandler(() => false)
}

const configuredServerSessions = new WeakSet<Session>()

/**
 * Grants `SERVER_PERMISSIONS` to the selected server window's own page and
 * denies everything else.
 */
function configureServerSession(host: Host, target: Session): void {
  if (configuredServerSessions.has(target)) return
  configuredServerSessions.add(target)
  const allowed = (
    contents: WebContents | null,
    permission: string,
    requestingUrl: string,
    isMainFrame: boolean,
  ) => {
    const remote = host.remote
    return (
      remote !== null &&
      !remote.window.isDestroyed() &&
      contents === remote.window.webContents &&
      isMainFrame &&
      isSameOrigin(requestingUrl, remote.origin) &&
      isSameOrigin(contents.getURL(), remote.origin) &&
      SERVER_PERMISSIONS.has(permission)
    )
  }
  target.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        allowed(
          contents,
          permission,
          details.requestingUrl,
          details.isMainFrame,
        ),
      ),
  )
  target.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      allowed(contents, permission, requestingOrigin, details.isMainFrame),
  )
  watchSessionCookies(target)
}

/** The persistent profile of one server, created on first use. */
export function serverSession(origin: string): Session {
  return session.fromPartition(serverPartition(origin))
}

/** Shows the connect screen, creating it when it does not exist. */
export function showConnect(host: Host): void {
  const existing = host.connectWindow
  if (existing && !existing.isDestroyed()) {
    // A freshly created window is shown once it reports it has rendered.
    if (!host.connectPending) showWindow(existing)
    return
  }
  host.connectPending = true
  try {
    host.connectWindow = createConnectWindow(host)
  } catch (cause) {
    host.connectPending = false
    log.warn("Could not open the connect window. %s", asError(cause))
    return
  }
  setTimeout(() => showPendingConnect(host), CONNECT_SHOW_FALLBACK_MS)
}

/** Shows a connect screen that was waiting for its first paint. */
export function showPendingConnect(host: Host): void {
  if (!host.connectPending) return
  host.connectPending = false
  showConnect(host)
}

/**
 * The connect screen only lives while it is needed: it is destroyed once a
 * server window takes over, and recreated when the user switches servers.
 */
function createConnectWindow(host: Host): BrowserWindow {
  const state = restoredWindowState(host.preferences)
  const window = new BrowserWindow({
    title: "Alloy",
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    useContentSize: true,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(PRELOAD_DIR, "connect.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  if (state.maximized) maximizeOnShow.add(window)
  denyAllPermissions(window.webContents.session)
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const keepLocal = (event: { url: string; preventDefault(): void }) => {
    if (!isConnectPageUrl(event.url)) event.preventDefault()
  }
  window.webContents.on("will-navigate", keepLocal)
  window.webContents.on("will-redirect", keepLocal)
  window.webContents.on("context-menu", (_event, params) =>
    showEditMenu(window, params),
  )
  trackWindowState(window, host.preferences)
  window.on("close", () => {
    host.sendCancel()
    // Closing the connect screen returns to the server that was open before
    // a server switch, if any. Without one the app stays in the tray.
    if (!host.quitting) focusRemote(host)
  })
  window.on("closed", () => {
    if (host.connectWindow !== window) return
    host.connectWindow = null
    host.connectPending = false
  })
  const devServer = process.env.ELECTRON_RENDERER_URL
  const loaded =
    !app.isPackaged && devServer
      ? window.loadURL(devServer)
      : window.loadFile(connectPagePath())
  loaded.catch((cause: Error) => {
    // Closing the window while it loads aborts the load; that is no error.
    if (!window.isDestroyed()) {
      log.warn("Could not load the connect screen. %s", cause)
    }
  })
  return window
}

/** Shows and focuses the selected server window, if any. */
export function focusRemote(host: Host): boolean {
  const window = host.remote?.window
  if (!window || window.isDestroyed()) return false
  showWindow(window)
  return true
}

export function destroyConnect(host: Host): void {
  const window = host.connectWindow
  if (window && !window.isDestroyed()) window.destroy()
}

/** Shows the server window and drops the connect screen, or opens it. */
export function showActive(host: Host): void {
  if (focusRemote(host)) destroyConnect(host)
  else showConnect(host)
}

export function showSettings(host: Host): void {
  const window = host.remote?.window
  if (!window || window.isDestroyed()) {
    showConnect(host)
    return
  }
  showWindow(window)
  openSettings(window)
}

/**
 * A mounted web app opens its settings through its router. Older web builds,
 * and pages outside the app layout, fall back to navigating there.
 */
export function openSettings(window: BrowserWindow): Promise<void> {
  return window.webContents
    .executeJavaScript(
      "(() => { if (!window.dispatchEvent(new Event('alloy:open-settings', { cancelable: true }))) return; const url = new URL(window.location.href); url.pathname = '/'; url.search = '?settings=desktop'; window.location.assign(url.href); })()",
    )
    .then(
      () => undefined,
      (cause: Error) => {
        log.warn("Could not open Alloy settings. %s", cause)
        throw new Error("Could not open Alloy settings.")
      },
    )
}

/** Resolves once a page from the server has loaded in the window. */
export interface PageLoad {
  wait(): Promise<void>
}

export interface RemoteWindow {
  window: BrowserWindow
  loaded: PageLoad
}

/**
 * Builds the hidden, frameless window for `origin`. It stays empty until
 * `activateRemote` loads the server. The web app draws its own title bar
 * and window controls.
 */
export function createRemoteWindow(
  host: Host,
  origin: string,
  generation: number,
): RemoteWindow {
  const state = restoredWindowState(host.preferences)
  const profile = serverSession(origin)
  configureServerSession(host, profile)
  const window = new BrowserWindow({
    title: "Alloy",
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: WINDOW_BACKGROUND,
    icon: appIconPath(),
    webPreferences: {
      session: profile,
      preload: join(PRELOAD_DIR, "server.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      additionalArguments: [`${SELECTED_ORIGIN_ARGUMENT}${origin}`],
    },
  })
  if (state.maximized) maximizeOnShow.add(window)

  let done = false
  let resolveLoaded = () => {}
  const loadedPromise = new Promise<void>((resolve) => {
    resolveLoaded = resolve
  })
  window.webContents.on("did-finish-load", () => {
    if (done || !isSameOrigin(window.webContents.getURL(), origin)) return
    done = true
    resolveLoaded()
  })

  const stayOnServer = (event: { url: string; preventDefault(): void }) => {
    if (isSameOrigin(event.url, origin)) return
    // A link that leaves the server belongs in the user's browser rather
    // than in a window holding the native bridge.
    event.preventDefault()
    openExternal(event.url)
  }
  window.webContents.on("will-navigate", stayOnServer)
  window.webContents.on("will-redirect", stayOnServer)
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("context-menu", (_event, params) =>
    showEditMenu(window, params),
  )
  window.webContents.on("render-process-gone", (_event, details) => {
    log.warn(`The server window's renderer stopped: ${details.reason}`)
  })

  window.on("close", (event) => {
    // Alt+F4 and the like behave like the title bar's close button: hide to
    // the tray and keep the server selected.
    if (host.quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on("closed", () => {
    if (!host.clearRemote(generation) || host.quitting) return
    const runtime = host.runtime
    void (runtime ? runtime.selectServer(null) : Promise.resolve())
      .catch(() => undefined)
      .then(() => showConnect(host))
  })
  trackWindowState(window, host.preferences)
  return { window, loaded: { wait: () => loadedPromise } }
}
