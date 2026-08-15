import type { RecordingStatus } from "@alloy/contracts"

import type {
  SidecarConfig,
  SidecarRequest,
} from "./recording-sidecar-protocol"

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

interface SidecarConfigureQueueOptions {
  request: (
    method: "configure" | "status",
    params?: SidecarRequest["params"],
  ) => Promise<RecordingStatus>
  /** Queued configures stop flushing once the owning client is shutting down. */
  isShutdown: () => boolean
}

/**
 * Coalesces configure pushes to the sidecar: duplicate pushes reuse the
 * in-flight promise, and while a configure is in flight only the latest
 * queued config is kept.
 */
export class SidecarConfigureQueue {
  private readonly options: SidecarConfigureQueueOptions
  private appliedConfigKey: string | null = null
  private inFlightConfigure: InFlightConfigure | null = null
  private queuedConfigure: QueuedConfigure | null = null

  constructor(options: SidecarConfigureQueueOptions) {
    this.options = options
  }

  configure(config: SidecarConfig): Promise<RecordingStatus> {
    const key = JSON.stringify(config)
    if (this.inFlightConfigure?.key === key) {
      this.resolveQueuedConfigureWith(this.inFlightConfigure.promise)
      return this.inFlightConfigure.promise
    }
    if (this.inFlightConfigure) return this.queueConfigure(key, config)
    if (this.queuedConfigure?.key === key) return this.queuedConfigure.promise
    if (this.appliedConfigKey === key) {
      return this.options.request("status")
    }
    return this.sendConfigure(key, config)
  }

  /** Forget all coalescing state; called when a fresh process spawns. */
  reset(): void {
    this.appliedConfigKey = null
    this.inFlightConfigure = null
    this.queuedConfigure = null
  }

  /** Drop in-flight bookkeeping and reject the queued configure, if any. */
  fail(error: Error): void {
    this.appliedConfigKey = null
    this.inFlightConfigure = null
    this.rejectQueuedConfigure(error)
  }

  rejectQueuedConfigure(error: Error): void {
    const queued = this.queuedConfigure
    if (!queued) return

    this.queuedConfigure = null
    queued.reject(error)
  }

  private sendConfigure(
    key: string,
    config: SidecarConfig,
  ): Promise<RecordingStatus> {
    const promise = this.options
      .request("configure", config)
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
            : new Error("Alloy agent configure failed.")
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
    if (!queued || this.inFlightConfigure || this.options.isShutdown()) return

    this.queuedConfigure = null
    if (this.appliedConfigKey === queued.key) {
      void this.options
        .request("status")
        .then(queued.resolve, (cause: unknown) =>
          queued.reject(
            cause instanceof Error
              ? cause
              : new Error("Alloy agent status failed."),
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
}
