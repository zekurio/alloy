import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import type { NativeJson } from "../shared/ipc"
import { asError, log } from "./log"

// Saved servers and window geometry, kept in `preferences.json` in the app's
// data folder. Every method is synchronous, so the main process runs one
// read-modify-write to its end before the next IPC call reads the file, and
// concurrent calls cannot drop each other's change. Keys this module does not
// know stay in the file when it is rewritten.

const PREFERENCES_FILE = "preferences.json"
const MAX_SAVED_SERVERS = 8
/** The smallest window the web app can lay out in. */
export const MIN_WINDOW_WIDTH = 800
export const MIN_WINDOW_HEIGHT = 600
/**
 * Upper bound for a saved size, so a corrupted preferences file cannot ask
 * for an absurd window.
 */
const MAX_WINDOW_DIMENSION = 16_384
/** The shape of `DesktopSavedServer` in the renderer contract. */
export type SavedServer = { serverUrl: string; serverVersion: string }

/**
 * Window geometry remembered across restarts. Sizes are logical pixels, so a
 * display scale change keeps the same apparent size.
 */
export interface WindowState {
  width: number
  height: number
  maximized: boolean
}

type JsonObject = { [key: string]: NativeJson }

/** The file's document, or `corrupt` when it exists but is no JSON object. */
type StoredDocument = JsonObject | "corrupt"

let temporaryFiles = 0

export class Preferences {
  private readonly path: string

  /**
   * `canonicalOrigin` is the host's `normalizeServerOrigin`: it returns a
   * server URL's canonical origin or throws why the URL is not acceptable.
   */
  constructor(
    directory: string,
    private readonly canonicalOrigin: (url: string) => string,
  ) {
    this.path = join(directory, PREFERENCES_FILE)
  }

  /** Most recent first. */
  servers(): SavedServer[] {
    return this.storedServers(this.readDocument())
  }

  currentServer(): string | null {
    return this.servers()[0]?.serverUrl ?? null
  }

  /** Moves a server that passed `prepareServer` to the top of the list. */
  rememberServer(server: string, version: string): SavedServer[] {
    const serverUrl = this.canonicalOrigin(server)
    return this.updateServers((servers) =>
      [
        { serverUrl, serverVersion: version },
        ...servers.filter((saved) => saved.serverUrl !== serverUrl),
      ].slice(0, MAX_SAVED_SERVERS),
    )
  }

  forgetServer(server: string): SavedServer[] {
    const serverUrl = this.canonicalOrigin(server)
    return this.updateServers((servers) =>
      servers.filter((saved) => saved.serverUrl !== serverUrl),
    )
  }

  /** The saved size, unless it is outside what a window may open with. */
  windowState(): WindowState | null {
    const stored = own(this.readDocument(), "window")
    if (!isJsonObject(stored)) return null
    const width = own(stored, "width")
    const height = own(stored, "height")
    if (
      !inRange(width, MIN_WINDOW_WIDTH) ||
      !inRange(height, MIN_WINDOW_HEIGHT)
    ) {
      return null
    }
    const maximized = own(stored, "maximized")
    return {
      width,
      height,
      maximized: typeof maximized === "boolean" ? maximized : false,
    }
  }

  /** Saves a window size, clamped as by `clampWindowState`; returns it. */
  rememberWindowState(state: WindowState): WindowState {
    const clamped = clampWindowState(state)
    this.update("Could not save the window size.", (document) => {
      document.window = {
        width: clamped.width,
        height: clamped.height,
        maximized: clamped.maximized,
      }
    })
    return clamped
  }

  private updateServers(
    change: (servers: SavedServer[]) => SavedServer[],
  ): SavedServer[] {
    return this.update("Could not save server settings.", (document) => {
      const servers = change(this.storedServers(document))
      document.servers = servers
      return servers
    })
  }

  /**
   * The valid entries, without duplicates: an entry whose URL the host
   * rejects or whose version is empty is dropped.
   */
  private storedServers(document: JsonObject): SavedServer[] {
    const stored = own(document, "servers")
    if (!Array.isArray(stored)) return []
    const servers: SavedServer[] = []
    for (const entry of stored) {
      if (servers.length === MAX_SAVED_SERVERS) break
      if (!isJsonObject(entry)) continue
      const url = own(entry, "serverUrl")
      const version = own(entry, "serverVersion")
      if (typeof url !== "string" || typeof version !== "string") continue
      const serverVersion = version.trim()
      if (!serverVersion) continue
      let serverUrl: string
      try {
        serverUrl = this.canonicalOrigin(url)
      } catch {
        continue
      }
      if (servers.some((server) => server.serverUrl === serverUrl)) continue
      servers.push({ serverUrl, serverVersion })
    }
    return servers
  }

  /**
   * The document for reading. A file that cannot be read or is corrupt reads
   * as empty; only `update` decides what happens to it.
   */
  private readDocument(): JsonObject {
    let stored: StoredDocument
    try {
      stored = this.readStored()
    } catch (cause) {
      log.warn(`Could not read ${this.path}: ${asError(cause).message}`)
      return {}
    }
    if (stored !== "corrupt") return stored
    log.warn(`${this.path} is not a valid preferences file.`)
    return {}
  }

  /** Throws when the file exists but cannot be read. */
  private readStored(): StoredDocument {
    let raw: Buffer
    try {
      raw = readFileSync(this.path)
    } catch (cause) {
      if (isErrorCode(cause, "ENOENT")) return {}
      throw cause
    }
    return parseDocument(raw)
  }

  /**
   * Applies `change` to the stored document and writes it back. A file that
   * cannot be read is left alone and the change fails with `failure`:
   * writing over it would drop every other setting. A corrupt file is moved
   * to `preferences.json.bak` first, so the saved servers in it can still be
   * recovered by hand.
   */
  private update<T>(failure: string, change: (document: JsonObject) => T): T {
    let stored: StoredDocument
    try {
      stored = this.readStored()
    } catch (cause) {
      log.warn(`Could not read ${this.path}: ${asError(cause).message}`)
      throw new Error(failure, { cause })
    }
    let document: JsonObject
    if (stored === "corrupt") {
      const backup = `${this.path}.bak`
      try {
        renameSync(this.path, backup)
      } catch (cause) {
        log.warn(
          `Could not move the corrupt ${this.path} aside: ${asError(cause).message}`,
        )
        throw new Error(failure, { cause })
      }
      log.warn(
        `${this.path} was not a valid preferences file. Moved it to ${backup} and started a new one.`,
      )
      document = {}
    } else {
      document = stored
    }
    const result = change(document)
    try {
      writeAtomically(this.path, JSON.stringify(document, null, 2))
    } catch (cause) {
      log.warn(`Could not write ${this.path}: ${asError(cause).message}`)
      throw new Error(failure, { cause })
    }
    return result
  }
}

/**
 * A size that is safe to restore: no smaller than the web app's minimum and
 * no larger than any real display.
 */
export function clampWindowState(state: WindowState): WindowState {
  const clamp = (value: number, minimum: number) =>
    Math.min(Math.max(Math.trunc(value), minimum), MAX_WINDOW_DIMENSION)
  return {
    width: clamp(state.width, MIN_WINDOW_WIDTH),
    height: clamp(state.height, MIN_WINDOW_HEIGHT),
    maximized: state.maximized,
  }
}

function inRange(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= MAX_WINDOW_DIMENSION
  )
}

/**
 * The file's object, or `corrupt` when it is not valid UTF-8 JSON or its
 * value is not an object.
 */
function parseDocument(raw: Buffer): StoredDocument {
  let value: unknown
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(raw)
    value = JSON.parse(text)
  } catch {
    return "corrupt"
  }
  return isJsonObject(value) ? value : "corrupt"
}

/** `value` came from `JSON.parse`, so an object's values are JSON too. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A key of the object itself, never one it inherits. */
function own(object: JsonObject, key: string): NativeJson | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined
}

function isErrorCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code
}

/**
 * Writes a temporary file beside `path`, flushes it to disk, and renames it
 * over `path`, so a crash leaves the old file or the new one.
 */
function writeAtomically(path: string, data: string): void {
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true })
  temporaryFiles += 1
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${temporaryFiles}.tmp`,
  )
  try {
    const file = openSync(temporary, "wx")
    try {
      writeFileSync(file, data)
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    renameSync(temporary, path)
  } catch (cause) {
    rmSync(temporary, { force: true })
    throw cause
  }
}
