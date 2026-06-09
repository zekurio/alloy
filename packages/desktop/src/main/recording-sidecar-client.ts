import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, delimiter, join } from "node:path"
import { createInterface, type Interface } from "node:readline"

import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "alloy-contracts"
import { logger } from "alloy-logging"

export interface SidecarConfig {
  settings: RecordingSettings
  outputFolder: string
  replayScratchFolder: string
  obsRuntimeDir: string | null
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

export interface RecordingSidecarVersion {
  name: string
  version: string
  protocolVersion: number
  capabilities: string[]
}

interface RecordingSidecarClientOptions {
  initialStatus: RecordingStatus
  runtimeDir: () => string | null
  emitEvent: (event: RecordingEvent) => void
}

const SIDECAR_TIMEOUT_MS = 20_000

export class RecordingSidecarClient {
  private readonly executable: string
  private readonly runtimeDir: () => string | null
  private readonly emitEvent: (event: RecordingEvent) => void
  private readonly pending = new Map<number, PendingRequest>()
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private configKey: string | null = null
  private lastStatus: RecordingStatus
  private shutdownRequested = false

  constructor(executable: string, options: RecordingSidecarClientOptions) {
    this.executable = executable
    this.runtimeDir = options.runtimeDir
    this.emitEvent = options.emitEvent
    this.lastStatus = options.initialStatus
  }

  async configure(config: SidecarConfig): Promise<RecordingStatus> {
    const configKey = JSON.stringify(config)
    if (this.configKey === configKey && this.lastStatus.backend !== "missing") {
      return this.lastStatus
    }

    const status = await this.request<RecordingStatus>("configure", config)
    this.configKey = configKey
    this.lastStatus = status
    return status
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

  private ensureProcess() {
    if (this.child) return

    const runtimeDir = this.runtimeDir()
    const child = spawn(this.executable, [], {
      stdio: "pipe",
      windowsHide: true,
      env: sidecarEnv(runtimeDir),
      cwd: sidecarCwd(runtimeDir),
    }) as ChildProcessWithoutNullStreams

    this.child = child
    this.shutdownRequested = false
    child.stdin.setDefaultEncoding("utf8")

    this.reader = createInterface({ input: child.stdout })
    this.reader.on("line", (line) => this.handleLine(line))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim()
      if (message.length > 0)
        logger.warn(`[desktop] ${basename(this.executable)}: ${message}`)
    })
    child.on("error", (cause) =>
      this.handleExit(errorText(cause, "Recording sidecar failed.")),
    )
    child.on("exit", (code, signal) => {
      if (this.shutdownRequested) return
      this.handleExit(sidecarExitMessage(code, signal))
    })
  }

  private handleLine(line: string) {
    if (!line.trimStart().startsWith("{")) {
      logger.warn(`[desktop] ${basename(this.executable)}: ${line}`)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (cause) {
      logger.warn("[desktop] invalid recording sidecar JSON:", cause)
      return
    }

    if (isSidecarEventEnvelope(parsed)) {
      this.applyEvent(parsed.event)
      this.emitEvent(parsed.event)
      return
    }

    if (!isSidecarResponse(parsed)) {
      logger.warn("[desktop] unknown recording sidecar message:", parsed)
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
    logger.warn("[desktop] recording sidecar stopped:", message)
    this.child = null
    this.reader?.close()
    this.reader = null
    this.configKey = null
    const status = { ...this.lastStatus, backend: "error" as const, message }
    this.lastStatus = status
    this.rejectPending(new Error(message))
    this.emitEvent({ type: "error", error: message, status })
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function sidecarEnv(runtimeDir: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env }
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
