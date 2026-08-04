import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { basename } from "node:path"
import { createInterface, type Interface } from "node:readline"

import type { RecordingStatus } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"

import { SidecarConfigureQueue } from "./recording-sidecar-configure"
import {
  errorText,
  sidecarCwd,
  sidecarEnv,
  sidecarExitMessage,
} from "./recording-sidecar-process"
import {
  assertCurrentAgentVersion,
  isSidecarEventEnvelope,
  isSidecarResponse,
  type RecordingSidecarVersion,
  type SidecarConfig,
  type SidecarEvent,
  type SidecarMethod,
  type SidecarRequest,
} from "./recording-sidecar-protocol"

export type { RecordingSidecarVersion, SidecarConfig, SidecarEvent }

const logger = createLogger("sidecar")

interface PendingRequest {
  method: SidecarMethod
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface RecordingSidecarClientOptions {
  initialStatus: RecordingStatus
  /** Source of truth for the sidecar config, owned by the desktop shell. */
  config: () => SidecarConfig
  emitEvent: (event: SidecarEvent) => void
}

const SIDECAR_TIMEOUT_MS = 20_000
// Video-setting changes stop the active output (up to 8 seconds), tear OBS
// down, rediscover devices, and start it again. The recorder intentionally
// finishes configure requests even after their caller deadline, so timing out
// first would replace a healthy late status with a spurious backend error.
const SIDECAR_CONFIGURE_TIMEOUT_MS = 45_000
const SIDECAR_SHUTDOWN_REQUEST_TIMEOUT_MS = 1_500
const SIDECAR_GRACEFUL_EXIT_TIMEOUT_MS = 1_500
const SIDECAR_FORCED_EXIT_TIMEOUT_MS = 1_500
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
  private readonly emitEvent: (event: SidecarEvent) => void
  private readonly pending = new Map<number, PendingRequest>()
  private readonly configureQueue: SidecarConfigureQueue
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private lastStatus: RecordingStatus
  private shutdownRequested = false
  private respawnTimer: ReturnType<typeof setTimeout> | null = null
  private consecutiveRespawns = 0
  private spawnedAt = 0
  private ready: Promise<void> | null = null

  constructor(executable: string, options: RecordingSidecarClientOptions) {
    this.executable = executable
    this.config = options.config
    this.emitEvent = options.emitEvent
    this.lastStatus = options.initialStatus
    this.configureQueue = new SidecarConfigureQueue({
      request: (method, params) =>
        this.requestRaw<RecordingStatus>(method, params),
      isShutdown: () => this.shutdownRequested,
    })
  }

  /**
   * Push the given config to the sidecar. Duplicate pushes are coalesced, and
   * while a configure is in flight only the latest queued config is kept.
   */
  async configure(config: SidecarConfig): Promise<RecordingStatus> {
    this.ensureProcess()
    await this.ready
    return this.configureQueue.configure(config)
  }

  async version(): Promise<RecordingSidecarVersion> {
    return await this.request<RecordingSidecarVersion>("version")
  }

  async request<T>(method: SidecarMethod, params?: unknown): Promise<T> {
    this.ensureProcess()
    await this.ready
    return this.requestRaw<T>(method, params)
  }

  private requestRaw<T>(method: SidecarMethod, params?: unknown): Promise<T> {
    const child = this.child
    if (!child) throw new Error("Alloy agent is not available.")

    const id = this.nextId++
    const timeoutMs =
      method === "configure" ? SIDECAR_CONFIGURE_TIMEOUT_MS : SIDECAR_TIMEOUT_MS
    const request: SidecarRequest = {
      id,
      method,
      params,
      deadlineUnixMs: Date.now() + timeoutMs,
    }
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Alloy agent timed out during ${method}.`))
      }, timeoutMs)

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

  /** Resolves false when the process did not exit within the deadlines. */
  async shutdown(): Promise<boolean> {
    this.shutdownRequested = true
    this.cancelRespawn()
    const child = this.child
    if (!child) return true

    // The shutdown response precedes final process cleanup. Killing immediately
    // after it can leave the executable locked by Windows and break NSIS updates.
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      child.once("exit", () => resolve())
    })

    try {
      await Promise.race([
        this.request<RecordingStatus>("shutdown"),
        delay(SIDECAR_SHUTDOWN_REQUEST_TIMEOUT_MS),
      ])
    } catch {
      // The process may already be exiting; below we still wait for it.
    }

    child.stdin.end()
    const exitedGracefully = await settledWithin(
      exited,
      SIDECAR_GRACEFUL_EXIT_TIMEOUT_MS,
    )
    if (!exitedGracefully) child.kill()
    const exitedAfterKill =
      exitedGracefully ||
      (await settledWithin(exited, SIDECAR_FORCED_EXIT_TIMEOUT_MS))

    this.child = null
    this.ready = null
    this.reader?.close()
    this.reader = null
    const error = new Error("Alloy agent was shut down.")
    this.rejectPending(error)
    this.configureQueue.rejectQueuedConfigure(error)
    return exitedAfterKill
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
    this.configureQueue.reset()
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
      this.handleExit(errorText(cause, t("Alloy agent failed."))),
    )
    child.on("exit", (code, signal) => {
      if (this.shutdownRequested) return
      this.handleExit(sidecarExitMessage(code, signal))
    })

    // The 1.0 baseline is strict: validate the binary before configuration
    // or work. Every public request awaits this same handshake.
    this.ready = this.startAgent(config)
    void this.ready.catch((cause: unknown) => {
      logger.warn("Alloy agent startup handshake failed:", cause)
    })
  }

  private async startAgent(config: SidecarConfig): Promise<void> {
    assertCurrentAgentVersion(
      await this.requestRaw<RecordingSidecarVersion>("version"),
    )
    await this.configureQueue.configure(config)
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
      logger.warn("invalid Alloy agent JSON:", cause)
      return
    }

    if (isSidecarEventEnvelope(parsed)) {
      this.applyEvent(parsed.event)
      this.emitEvent(parsed.event)
      return
    }

    if (!isSidecarResponse(parsed)) {
      logger.warn("unknown Alloy agent message:", parsed)
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
        new Error(parsed.error ?? `Alloy agent ${pending.method} failed.`),
      )
      return
    }

    pending.resolve(parsed.result)
  }

  private applyEvent(event: SidecarEvent) {
    if ("status" in event) this.lastStatus = event.status
  }

  private handleExit(message: string) {
    logger.warn("Alloy agent stopped:", message)
    this.child = null
    this.ready = null
    this.reader?.close()
    this.reader = null
    const error = new Error(message)
    this.configureQueue.fail(error)
    const status = { ...this.lastStatus, backend: "error" as const, message }
    this.lastStatus = status
    this.rejectPending(error)
    this.emitEvent({ type: "error", error: message, status })
    this.scheduleRespawn()
  }

  /**
   * Restart the sidecar after an unexpected exit so background capture keeps
   * working without user interaction, but give up on crash loops.
   */
  private scheduleRespawn() {
    if (this.shutdownRequested || this.respawnTimer) return
    this.consecutiveRespawns =
      Date.now() - this.spawnedAt >= RESPAWN_STREAK_RESET_MS
        ? 1
        : this.consecutiveRespawns + 1
    if (this.consecutiveRespawns > MAX_CONSECUTIVE_RESPAWNS) {
      logger.warn("Alloy agent keeps crashing; not restarting it again")
      return
    }

    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null
      if (this.shutdownRequested || this.child) return
      logger.info("restarting Alloy agent")
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

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

async function settledWithin(
  promise: Promise<void>,
  durationMs: number,
): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    delay(durationMs).then(() => false),
  ])
}
