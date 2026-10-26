import { shell, type BrowserWindow, type Session } from "electron"

import type { NativeJson } from "../shared/ipc"
import {
  clearSessionCookies,
  flushCookies,
  hasSavedSession,
  storeSessionToken,
} from "./cookies"
import type { Host, RemoteSession } from "./host"
import { asError, log } from "./log"
import type { PreparedServer, SessionToken } from "./native"
import {
  createRemoteWindow,
  destroyConnect,
  serverSession,
  showConnect,
  showWindow,
  type PageLoad,
} from "./windows"

const SIGN_IN_CANCELLED = "Sign-in was cancelled."
/**
 * How long a server window stays hidden waiting for its page to load before
 * it is shown anyway, so a slow server still surfaces the window.
 */
const REMOTE_SHOW_FALLBACK_MS = 3000

/**
 * The window's profile holds no session for the server. Not a failure to
 * report: the connect flow answers it with a browser sign-in.
 */
class NoSavedSession extends Error {
  constructor() {
    super("No saved Alloy session was found.")
  }
}

function ensureNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(SIGN_IN_CANCELLED)
}

function whenCancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const cancelled = () => reject(new Error(SIGN_IN_CANCELLED))
    if (signal.aborted) cancelled()
    else signal.addEventListener("abort", cancelled, { once: true })
  })
}

function untilCancelled<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return Promise.race([pending, whenCancelled(signal)])
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Validates the server, signs in if needed, and opens its window. The
 * bundled connect screen and the in-app server switch both come here.
 */
export async function connectToServer(
  host: Host,
  url: string,
): Promise<{ serverUrl: string }> {
  const release = host.connecting.tryAcquire()
  if (!release) throw new Error("A server connection is already in progress.")
  const attempt = new AbortController()
  host.cancel = attempt
  const { signal } = attempt
  try {
    const server = await untilCancelled(host.native.prepareServer(url), signal)
    let generation: number
    try {
      generation = await withSelection(host, () =>
        installRemote(host, server.origin, null, signal, true),
      )
    } catch (cause) {
      if (!(cause instanceof NoSavedSession)) throw cause
      const token = await browserSignIn(host, server.origin, signal)
      ensureNotCancelled(signal)
      generation = await withSelection(host, () =>
        installRemote(host, server.origin, token, signal, true),
      )
    }
    if (signal.aborted) {
      await abandonRemote(host, generation)
      throw new Error(SIGN_IN_CANCELLED)
    }
    rememberConnected(host, server)
    return { serverUrl: server.origin }
  } finally {
    if (host.cancel === attempt) host.cancel = null
    release()
  }
}

async function withSelection<T>(host: Host, run: () => Promise<T>): Promise<T> {
  const release = await host.selection.acquire()
  try {
    return await run()
  } finally {
    release()
  }
}

/**
 * Saves a server whose window is now open. A failure only costs restoring
 * it on the next launch, so it is logged instead of undoing the switch.
 */
function rememberConnected(host: Host, server: PreparedServer): void {
  try {
    host.preferences.rememberServer(server.origin, server.version)
  } catch (cause) {
    log.warn("Could not save the Alloy server: %s", asError(cause))
  }
}

/** Opens the sign-in page in the browser and waits for its callback. */
async function browserSignIn(
  host: Host,
  origin: string,
  signal: AbortSignal,
): Promise<SessionToken> {
  const starting = host.native.startBrowserSignIn(origin)
  // A sign-in that starts after a cancel still frees its callback port.
  starting.then(
    (signIn) => {
      if (signal.aborted) signIn.cancel()
    },
    () => undefined,
  )
  const signIn = await untilCancelled(starting, signal)
  const cancel = () => signIn.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  try {
    ensureNotCancelled(signal)
    await shell.openExternal(signIn.authorizeUrl).catch((cause: Error) => {
      log.warn("Could not open the sign-in page in your browser. %s", cause)
      throw new Error("Could not open the sign-in page in your browser.")
    })
    return await signIn.finish()
  } finally {
    signal.removeEventListener("abort", cancel)
    signIn.cancel()
  }
}

/**
 * Opens the server window with a session and selects it. `show` is false
 * for a login-item start: the saved server is restored so the recorder warms
 * up, but its window stays hidden until the user opens it from the tray.
 */
async function installRemote(
  host: Host,
  origin: string,
  token: SessionToken | null,
  signal: AbortSignal,
  show: boolean,
): Promise<number> {
  ensureNotCancelled(signal)
  const generation = ++host.nextGeneration
  const { window, loaded } = createRemoteWindow(host, origin, generation)
  try {
    await signInRemote(window, origin, token, signal)
  } catch (cause) {
    window.destroy()
    throw cause
  }
  const previous = host.remote
  host.remote = { generation, origin, window }

  // From here on the new window is the selected session. Every failure
  // hands the selection back to the previous window, if any.
  try {
    await activateRemote(host, window, origin, loaded, signal, show)
  } catch (cause) {
    host.restoreRemote(generation, previous)
    await host
      .requireRuntime()
      .selectServer(previous?.origin ?? null)
      .catch(() => undefined)
    window.destroy()
    throw cause
  }
  if (previous && !previous.window.isDestroyed()) previous.window.destroy()
  return generation
}

/**
 * Gives the new window its session: the token from a fresh sign-in, or the
 * cookie its profile kept from the last one.
 */
async function signInRemote(
  window: BrowserWindow,
  origin: string,
  token: SessionToken | null,
  signal: AbortSignal,
): Promise<void> {
  ensureNotCancelled(signal)
  const profile = window.webContents.session
  if (token) await storeSessionToken(profile, origin, token)
  else if (!(await hasSavedSession(profile, origin))) throw new NoSavedSession()
  ensureNotCancelled(signal)
}

/** Points the runtime at the new server, loads its page, and shows it. */
async function activateRemote(
  host: Host,
  window: BrowserWindow,
  origin: string,
  loaded: PageLoad,
  signal: AbortSignal,
  show: boolean,
): Promise<void> {
  await host.requireRuntime().selectServer(origin)
  // A failed load shows Chromium's error page, from which the web app's
  // reload brings the server back.
  window.loadURL(`${origin}/`).catch(() => undefined)
  ensureNotCancelled(signal)
  if (show) {
    // Stay hidden until the page has loaded, so the web app's boot splash
    // is the first thing on screen rather than an empty frameless window.
    await Promise.race([
      loaded.wait(),
      whenCancelled(signal).catch(() => undefined),
      delay(REMOTE_SHOW_FALLBACK_MS),
    ])
    ensureNotCancelled(signal)
    showWindow(window)
  }
  ensureNotCancelled(signal)
}

async function abandonRemote(host: Host, generation: number): Promise<void> {
  await withSelection(host, async () => {
    const session = host.remote
    if (session?.generation !== generation) return
    host.clearRemote(generation)
    await host
      .requireRuntime()
      .selectServer(null)
      .catch(() => undefined)
    session.window.destroy()
    showConnect(host)
  })
}

/** Removes a saved server and everything its profile kept. */
export async function forgetSavedServer(
  host: Host,
  origin: string,
): Promise<NativeJson> {
  const release = await host.connecting.acquire()
  try {
    const active = host.remote?.origin === origin ? host.remote : null
    if (active) {
      await withSelection(host, () => clearActiveProfile(host, active))
    } else {
      await clearProfile(serverSession(origin), origin)
    }
    return host.preferences.forgetServer(origin)
  } finally {
    release()
  }
}

async function clearActiveProfile(
  host: Host,
  active: RemoteSession,
): Promise<void> {
  await clearProfile(active.window.webContents.session, active.origin)
  await host.requireRuntime().selectServer(null)
  host.clearRemote(active.generation)
  active.window.destroy()
}

async function clearProfile(profile: Session, origin: string): Promise<void> {
  await clearSessionCookies(profile, origin)
  try {
    await profile.clearStorageData()
    await profile.clearCache()
  } catch (cause) {
    log.warn("Could not clear the Alloy server profile. %s", asError(cause))
    throw new Error("Could not clear the Alloy server profile.")
  }
  await flushCookies(profile)
}

/**
 * Restores the saved server at startup. Without one, or when it fails, the
 * connect screen opens instead, unless `show` is false (a tray start).
 */
export async function restoreSavedServer(
  host: Host,
  show: boolean,
): Promise<void> {
  const release = await host.connecting.acquire()
  try {
    const fallBackToConnect = () => {
      if (show) showConnect(host)
    }
    const url = host.preferences.currentServer()
    if (!url) {
      fallBackToConnect()
      return
    }
    let server: PreparedServer
    try {
      server = await host.native.prepareServer(url)
    } catch (cause) {
      log.warn("Could not restore the saved Alloy server: %s", asError(cause))
      fallBackToConnect()
      return
    }
    try {
      // The restore is never cancelled.
      const signal = new AbortController().signal
      await withSelection(host, () =>
        installRemote(host, server.origin, null, signal, show),
      )
      rememberConnected(host, server)
      // The connect screen only exists here if it was opened from the tray
      // while the server was still being restored.
      destroyConnect(host)
    } catch (cause) {
      if (!(cause instanceof NoSavedSession)) {
        log.warn("Could not restore the saved Alloy server: %s", asError(cause))
      }
      fallBackToConnect()
    }
  } finally {
    release()
  }
}

/** Cancels the connection attempt and resolves once it has stopped. */
export async function cancelConnect(host: Host): Promise<void> {
  host.sendCancel()
  const release = await host.connecting.acquire()
  release()
}
