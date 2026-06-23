import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { basename } from "node:path"
import { createInterface, type Interface } from "node:readline"

import type { RecordingEvent, RecordingStatus } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"

import {
  errorText,
  sidecarCwd,
  sidecarEnv,
  sidecarExitMessage,
} from "./recording-sidecar-process"
import {
  isSidecarEventEnvelope,
  isSidecarResponse,
  type RecordingSidecarVersion,
  type SidecarConfig,
  type SidecarMethod,
  type SidecarRequest,
} from "./recording-sidecar-protocol"

export type { RecordingSidecarVersion, SidecarConfig }

const logger = createLogger("sidecar")

interface PendingRequest {
  method: SidecarMethod
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface InFlightConfigure {
  key: string
  promise: Promise<RecordingStatus>
}

interface QueuedConfigure {
  key: string
  config: SidecarConfig
  promise: Promise<RecordingStatus>
  resolve: (value: RecordingStatus) => void
  reject: (reason: Error) => void
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
  private inFlightConfigure: InFlightConfigure | null = null
  private queuedConfigure: QueuedConfigure | null = null
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
   * while a configure is in flight only the latest queued config is kept.
   */
  async configure(config: SidecarConfig): Promise<RecordingStatus> {
    this.ensureProcess()
    const key = JSON.stringify(config)
    if (this.inFlightConfigure?.key === key) {
      this.resolveQueuedConfigureWith(this.inFlightConfigure.promise)
      return this.inFlightConfigure.promise
    }
    if (this.inFlightConfigure) return this.queueConfigure(key, config)
    if (this.queuedConfigure?.key === key) return this.queuedConfigure.promise
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
    const error = new Error("Recording sidecar was shut down.")
    this.rejectPending(error)
    this.rejectQueuedConfigure(error)
  }

  private sendConfigure(
    key: string,
    config: SidecarConfig,
  ): Promise<RecordingStatus> {
    const promise = this.request<RecordingStatus>("configure", config)
      .then(
        (status) => {
          if (this.inFlightConfigure?.key === key) {
            this.appliedConfigKey = key
          }
          return status
        },
        (cause: unknown) => {
          throw cause instanceof Error
            ? cause
            : new Error("Recording sidecar configure failed.")
        },
      )
      .finally(() => {
        if (this.inFlightConfigure?.key === key) this.inFlightConfigure = null
        this.flushQueuedConfigure()
      })
    this.inFlightConfigure = { key, promise }
    return promise
  }

  private queueConfigure(
    key: string,
    config: SidecarConfig,
  ): Promise<RecordingStatus> {
    if (this.queuedConfigure) {
      this.queuedConfigure.key = key
      this.queuedConfigure.config = config
      return this.queuedConfigure.promise
    }

    let resolveQueued: (value: RecordingStatus) => void = () => undefined
    let rejectQueued: (reason: Error) => void = () => undefined
    const promise = new Promise<RecordingStatus>((resolve, reject) => {
      resolveQueued = resolve
      rejectQueued = reject
    })
    this.queuedConfigure = {
      key,
      config,
      promise,
      resolve: resolveQueued,
      reject: rejectQueued,
    }
    return promise
  }

  private flushQueuedConfigure() {
    const queued = this.queuedConfigure
    if (!queued || this.inFlightConfigure || this.shutdownRequested) return

    this.queuedConfigure = null
    if (this.appliedConfigKey === queued.key) {
      void this.request<RecordingStatus>("status").then(
        queued.resolve,
        (cause: unknown) =>
          queued.reject(
            cause instanceof Error
              ? cause
              : new Error("Recording sidecar status failed."),
          ),
      )
      return
    }

    void this.sendConfigure(queued.key, queued.config).then(
      queued.resolve,
      queued.reject,
    )
  }

  private resolveQueuedConfigureWith(promise: Promise<RecordingStatus>) {
    const queued = this.queuedConfigure
    if (!queued) return

    this.queuedConfigure = null
    void promise.then(queued.resolve, queued.reject)
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
    this.inFlightConfigure = null
    this.queuedConfigure = null
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
      this.handleExit(errorText(cause, t("Recording sidecar failed."))),
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
    this.inFlightConfigure = null
    const error = new Error(message)
    this.rejectQueuedConfigure(error)
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

  private rejectQueuedConfigure(error: Error) {
    const queued = this.queuedConfigure
    if (!queued) return

    this.queuedConfigure = null
    queued.reject(error)
  }
}
