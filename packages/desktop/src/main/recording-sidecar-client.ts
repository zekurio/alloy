import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, delimiter, join } from "node:path"
import { createInterface, type Interface } from "node:readline"

import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

const logger = createLogger("sidecar")

export interface SidecarConfig {
  settings: RecordingSettings
  outputFolder: string
  replayScratchFolder: string
  obsRuntimeDir: string | null
  discordDetectionCachePath: string | null
}

type SidecarMethod =
  | "version"
  | "configure"
  | "status"
  | "listGameProcesses"
  | "listDisplays"
  | "saveReplayClip"
  | "addBookmark"
  | "toggleLongRecording"
  | "stopRecording"
  | "subscribeAudioLevels"
  | "stopAudioLevels"
  | "shutdown"

interface SidecarRequest {
  id: number
  method: SidecarMethod
  params?: unknown
}

interface SidecarResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  status?: RecordingStatus
}

interface SidecarEventEnvelope {
  event: RecordingEvent
}

interface PendingRequest {
  method: SidecarMethod
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingConfigure {
  key: string
  promise: Promise<RecordingStatus>
}

export interface RecordingSidecarVersion {
  name: string
  version: string
  protocolVersion: number
  capabilities: string[]
}

interface RecordingSidecarClientOptions {
  initialStatus: RecordingStatus
  /** Source of truth for the sidecar config, owned by the desktop shell. */
  config: () => SidecarConfig
  emitEvent: (event: RecordingEvent) => void
}

const SIDECAR_TIMEOUT_MS = 20_000
const RESPAWN_DELAY_MS = 3_000
const RESPAWN_STREAK_RESET_MS = 60_000
const MAX_CONSECUTIVE_RESPAWNS = 5

/**
 * Owns the sidecar process and the configuration handshake: the desktop shell
 * pushes config once on change, and the client re-pushes it whenever a fresh
 * process spawns. Reads (`status`, lists) never reconfigure the sidecar.
 */
export class RecordingSidecarClient {
  private readonly executable: string
  private readonly config: () => SidecarConfig
  private readonly emitEvent: (event: RecordingEvent) => void
  private readonly pending = new Map<number, PendingRequest>()
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private appliedConfigKey: string | null = null
  private pendingConfigure: PendingConfigure | null = null
  private lastStatus: RecordingStatus
  private shutdownRequested = false
  private respawnTimer: ReturnType<typeof setTimeout> | null = null
  private consecutiveRespawns = 0
  private spawnedAt = 0

  constructor(executable: string, options: RecordingSidecarClientOptions) {
    this.executable = executable
    this.config = options.config
    this.emitEvent = options.emitEvent
    this.lastStatus = options.initialStatus
  }

  /**
   * Push the given config to the sidecar. Duplicate pushes are coalesced, and
   * because requests are applied in stdin order the latest call always wins.
   */
  async configure(config: SidecarConfig): Promise<RecordingStatus> {
    this.ensureProcess()
    const key = JSON.stringify(config)
    if (this.pendingConfigure?.key === key) return this.pendingConfigure.promise
    if (this.appliedConfigKey === key) {
      return this.request<RecordingStatus>("status")
    }
    return this.sendConfigure(key, config)
  }

  async version(): Promise<RecordingSidecarVersion> {
    return await this.request<RecordingSidecarVersion>("version")
  }

  async request<T>(method: SidecarMethod, params?: unknown): Promise<T> {
    this.ensureProcess()
    const child = this.child
    if (!child) throw new Error("Recording sidecar is not available.")

    const id = this.nextId++
    const request: SidecarRequest = { id, method, params }
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Recording sidecar timed out during ${method}.`))
      }, SIDECAR_TIMEOUT_MS)

      this.pending.set(id, {
        method,
        timeout,
        resolve: (value) => resolve(value as T),
        reject,
      })

      child.stdin.write(`${JSON.stringify(request)}\n`, (cause) => {
        if (!cause) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.reject(cause)
      })
    })
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true
    this.cancelRespawn()
    if (!this.child) return

    try {
      await Promise.race([
        this.request<RecordingStatus>("shutdown"),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
    } catch {
      // The process may already be exiting; below we still close it.
    }

    this.child.stdin.end()
    this.child.kill()
    this.child = null
    this.reader?.close()
    this.reader = null
    this.rejectPending(new Error("Recording sidecar was shut down."))
  }

  private sendConfigure(
    key: string,
    config: SidecarConfig,
  ): Promise<RecordingStatus> {
    const promise = this.request<RecordingStatus>("configure", config).then(
      (status) => {
        if (this.pendingConfigure?.key === key) {
          this.pendingConfigure = null
          this.appliedConfigKey = key
        }
        return status
      },
      (cause: unknown) => {
        if (this.pendingConfigure?.key === key) this.pendingConfigure = null
        throw cause instanceof Error
          ? cause
          : new Error("Recording sidecar configure failed.")
      },
    )
    this.pendingConfigure = { key, promise }
    return promise
  }

  private ensureProcess() {
    if (this.child) return

    const config = this.config()
    const runtimeDir = config.obsRuntimeDir
    const discordDetectionCachePath = config.discordDetectionCachePath
    const child = spawn(this.executable, [], {
      stdio: "pipe",
      windowsHide: true,
      env: sidecarEnv(runtimeDir, discordDetectionCachePath),
      cwd: sidecarCwd(runtimeDir),
    }) as ChildProcessWithoutNullStreams

    this.child = child
    this.shutdownRequested = false
    this.spawnedAt = Date.now()
    this.appliedConfigKey = null
    this.pendingConfigure = null
    child.stdin.setDefaultEncoding("utf8")

    this.reader = createInterface({ input: child.stdout })
    this.reader.on("line", (line) => this.handleLine(line))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim()
      if (message.length > 0)
        logger.warn(`${basename(this.executable)}: ${message}`)
    })
    child.on("error", (cause) =>
      this.handleExit(errorText(cause, "Recording sidecar failed.")),
    )
    child.on("exit", (code, signal) => {
      if (this.shutdownRequested) return
      this.handleExit(sidecarExitMessage(code, signal))
    })

    // A fresh process knows nothing: push the current config before any
    // queued request reaches it (stdin order guarantees this runs first).
    void this.sendConfigure(JSON.stringify(config), config).catch(
      (cause: unknown) => {
        logger.warn("recording sidecar startup configure failed:", cause)
      },
    )
  }

  private handleLine(line: string) {
    if (!line.trimStart().startsWith("{")) {
      logger.warn(`${basename(this.executable)}: ${line}`)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (cause) {
      logger.warn("invalid recording sidecar JSON:", cause)
      return
    }

    if (isSidecarEventEnvelope(parsed)) {
      this.applyEvent(parsed.event)
      this.emitEvent(parsed.event)
      return
    }

    if (!isSidecarResponse(parsed)) {
      logger.warn("unknown recording sidecar message:", parsed)
      return
    }

    const pending = this.pending.get(parsed.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(parsed.id)

    if (parsed.status) {
      this.lastStatus = parsed.status
    }

    if (!parsed.ok) {
      pending.reject(
        new Error(
          parsed.error ?? `Recording sidecar ${pending.method} failed.`,
        ),
      )
      return
    }

    pending.resolve(parsed.result)
  }

  private applyEvent(event: RecordingEvent) {
    if ("status" in event) this.lastStatus = event.status
  }

  private handleExit(message: string) {
    logger.warn("recording sidecar stopped:", message)
    this.child = null
    this.reader?.close()
    this.reader = null
    this.appliedConfigKey = null
    this.pendingConfigure = null
    const status = { ...this.lastStatus, backend: "error" as const, message }
    this.lastStatus = status
    this.rejectPending(new Error(message))
    this.emitEvent({ type: "error", error: message, status })
    this.scheduleRespawn()
  }

  /**
   * Restart the sidecar after an unexpected exit so background capture keeps
   * working without user interaction, but give up on crash loops.
   */
  private scheduleRespawn() {
    if (this.shutdownRequested || this.respawnTimer) return
    if (!this.config().settings.enabled) return

    this.consecutiveRespawns =
      Date.now() - this.spawnedAt >= RESPAWN_STREAK_RESET_MS
        ? 1
        : this.consecutiveRespawns + 1
    if (this.consecutiveRespawns > MAX_CONSECUTIVE_RESPAWNS) {
      logger.warn("recording sidecar keeps crashing; not restarting it again")
      return
    }

    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null
      if (this.shutdownRequested || this.child) return
      logger.info("restarting recording sidecar")
      this.ensureProcess()
    }, RESPAWN_DELAY_MS)
    this.respawnTimer.unref?.()
  }

  private cancelRespawn() {
    if (!this.respawnTimer) return
    clearTimeout(this.respawnTimer)
    this.respawnTimer = null
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function sidecarEnv(
  runtimeDir: string | null,
  discordDetectionCachePath: string | null,
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (discordDetectionCachePath) {
    env.ALLOY_DISCORD_DETECTIONS_PATH = discordDetectionCachePath
  }
  if (!runtimeDir) return env

  env.ALLOY_OBS_RUNTIME_DIR = runtimeDir
  prependEnvPath(env, "PATH", [
    runtimeDir,
    join(runtimeDir, "bin"),
    join(runtimeDir, "bin", "64bit"),
  ])
  prependEnvPath(env, "LD_LIBRARY_PATH", [
    join(runtimeDir, "lib"),
    join(runtimeDir, "lib64"),
    join(runtimeDir, "bin"),
    join(runtimeDir, "bin", "64bit"),
  ])
  return env
}

function sidecarCwd(runtimeDir: string | null): string | undefined {
  if (!runtimeDir) return undefined

  for (const candidate of [
    join(runtimeDir, "bin", "64bit"),
    join(runtimeDir, "bin"),
    runtimeDir,
  ]) {
    if (existsSync(candidate)) return candidate
  }

  return undefined
}

function prependEnvPath(
  env: NodeJS.ProcessEnv,
  key: "PATH" | "LD_LIBRARY_PATH",
  paths: string[],
) {
  const envKey =
    Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    ) ?? key
  const existing = env[envKey]
  const present = paths.filter((path) => existsSync(path))
  if (present.length === 0) return
  env[envKey] = existing
    ? [...present, existing].join(delimiter)
    : present.join(delimiter)
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function sidecarExitMessage(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal) return `Recording sidecar exited from ${signal}.`
  if (code === null) return "Recording sidecar exited."
  return `Recording sidecar exited with code ${code}.`
}

function isSidecarEventEnvelope(value: unknown): value is SidecarEventEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    typeof (value as { event?: unknown }).event === "object"
  )
}

function isSidecarResponse(value: unknown): value is SidecarResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  )
}
