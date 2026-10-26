import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { app, type BrowserWindow, type IpcMainInvokeEvent } from "electron"

import type { NativeJson } from "../shared/ipc"
import type { NativeAddon, NativePreferences, NativeRuntime } from "./native"
import type { AppFolders } from "./paths"
import { isSameOrigin } from "./policy"

/** One holder at a time; later callers queue in order. */
export class AsyncLock {
  private locked = false
  private readonly waiters: (() => void)[] = []

  /** Resolves with the release function once the lock is free. */
  async acquire(): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    } else {
      this.locked = true
    }
    return this.releaser()
  }

  /** The release function, or null while someone holds the lock. */
  tryAcquire(): (() => void) | null {
    if (this.locked) return null
    this.locked = true
    return this.releaser()
  }

  private releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      // The next waiter takes the lock over without it ever being free.
      const next = this.waiters.shift()
      if (next) next()
      else this.locked = false
    }
  }
}

export interface RemoteSession {
  generation: number
  /** The server origin, e.g. `https://alloy.example`. */
  origin: string
  window: BrowserWindow
}

/** The shell's shared state, and the checks every IPC call makes against it. */
export class Host {
  /** Held by a connection attempt, a server restore, and a forget. */
  readonly connecting = new AsyncLock()
  /** Held while the selected server window changes. */
  readonly selection = new AsyncLock()
  /** Cancels the connection attempt in progress. */
  cancel: AbortController | null = null
  remote: RemoteSession | null = null
  nextGeneration = 0
  connectWindow: BrowserWindow | null = null
  /**
   * Set while a freshly created connect screen waits to be shown. It stays
   * hidden until its page has rendered, to avoid a blank window.
   */
  connectPending = false
  quitting = false
  runtime: NativeRuntime | null = null

  constructor(
    readonly native: NativeAddon,
    readonly preferences: NativePreferences,
    readonly folders: AppFolders,
  ) {}

  requireRuntime(): NativeRuntime {
    if (!this.runtime) throw new Error("Desktop runtime is not ready.")
    return this.runtime
  }

  /** Sends an event to the selected server window, if there is one. */
  sendToRemote(channel: string, payload: NativeJson): void {
    const window = this.remote?.window
    if (window && !window.isDestroyed())
      window.webContents.send(channel, payload)
  }

  /** Clears the selected session if it is still `generation`. */
  clearRemote(generation: number): boolean {
    if (this.remote?.generation !== generation) return false
    this.remote = null
    return true
  }

  /** Hands the selection back to `previous` if `generation` still holds it. */
  restoreRemote(generation: number, previous: RemoteSession | null): void {
    if (this.remote?.generation === generation) this.remote = previous
  }

  sendCancel(): void {
    this.cancel?.abort()
  }
}

function mainFrameUrl(event: IpcMainInvokeEvent): string | null {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return null
  return frame.url
}

/** The bundled connect page: the dev server's root, or the packaged file. */
export function isConnectPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const devServer = process.env.ELECTRON_RENDERER_URL
    if (!app.isPackaged && devServer) {
      const expected = new URL(devServer)
      return (
        parsed.origin === expected.origin &&
        (parsed.pathname === "/" || parsed.pathname === "/index.html")
      )
    }
    if (parsed.protocol !== "file:") return false
    const page = resolve(fileURLToPath(parsed))
    const expected = resolve(connectPagePath())
    // Windows paths compare without case: Chromium uppercases the drive
    // letter, while the app path keeps whatever case it was launched with.
    return process.platform === "win32"
      ? page.toLowerCase() === expected.toLowerCase()
      : page === expected
  } catch {
    return false
  }
}

export function connectPagePath(): string {
  return join(app.getAppPath(), "out", "renderer", "index.html")
}

export function requireConnectSender(
  host: Host,
  event: IpcMainInvokeEvent,
): void {
  const url = mainFrameUrl(event)
  const window = host.connectWindow
  if (
    url === null ||
    !window ||
    window.isDestroyed() ||
    window.webContents !== event.sender ||
    !isConnectPageUrl(url)
  ) {
    throw new Error("Only the bundled connect window can call this operation.")
  }
}

/**
 * The selected server session, if the sender is its window's main frame and
 * still shows that server.
 */
export function requireRemoteSender(
  host: Host,
  event: IpcMainInvokeEvent,
): RemoteSession {
  const url = mainFrameUrl(event)
  const remote = host.remote
  if (url === null) {
    throw new Error("Only the selected server window can call this operation.")
  }
  if (!remote || remote.window.isDestroyed()) {
    throw new Error("The server window is no longer active.")
  }
  if (
    remote.window.webContents !== event.sender ||
    !isSameOrigin(url, remote.origin)
  ) {
    throw new Error("The server window is not authorized for this server.")
  }
  return remote
}
