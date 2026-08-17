import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { t } from "@alloy/contracts/schema"

import {
  StrictFiniteNumberSchema,
  StrictStringSchema,
} from "../runtime-validation"

export interface HousekeepingResult {
  removedFiles: number
  removedBytes: number
}

export interface HousekeepingTask {
  id: string
  revision: number
  intervalMs: number | null
  run: (signal: AbortSignal) => Promise<HousekeepingResult>
}

interface HousekeepingLedger {
  version: 1
  tasks: Record<string, { revision: number; succeededAt: number }>
}

const HousekeepingLedgerSchema = t.object({
  version: StrictFiniteNumberSchema.refine((version) => version === 1),
  tasks: t.record(
    StrictStringSchema,
    t.object({
      revision: StrictFiniteNumberSchema.refine(
        (revision) => Number.isSafeInteger(revision) && revision > 0,
      ),
      succeededAt: StrictFiniteNumberSchema.refine(
        (succeededAt) => succeededAt >= 0,
      ),
    }),
  ),
})

interface HousekeepingLogger {
  info(message: string): void
  warn(message: string, cause?: unknown): void
}

export interface HousekeepingCoordinatorOptions {
  ledgerPath: string
  tasks: HousekeepingTask[]
  logger: HousekeepingLogger
  now?: () => number
}

/** Runs due desktop maintenance tasks in one serial, deduplicated lane. */
export class HousekeepingCoordinator {
  readonly #options: HousekeepingCoordinatorOptions
  readonly #controller = new AbortController()
  #pending: Promise<void> | null = null

  constructor(options: HousekeepingCoordinatorOptions) {
    this.#options = options
  }

  runDue(): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.resolve()
    if (this.#pending) return this.#pending

    const pending = this.#runDue().finally(() => {
      if (this.#pending === pending) this.#pending = null
    })
    this.#pending = pending
    return pending
  }

  stop(): void {
    this.#controller.abort()
  }

  async #runDue(): Promise<void> {
    const ledger = await readLedger(this.#options.ledgerPath)
    for (const task of this.#options.tasks) {
      if (this.#controller.signal.aborted) return
      if (!taskIsDue(task, ledger, this.#now())) continue

      const startedAt = this.#now()
      try {
        const result = await task.run(this.#controller.signal)
        if (this.#controller.signal.aborted) return
        ledger.tasks[task.id] = {
          revision: task.revision,
          succeededAt: this.#now(),
        }
        await writeLedger(this.#options.ledgerPath, ledger)
        this.#options.logger.info(
          `housekeeping ${task.id}@${task.revision} removed ${result.removedFiles} files (${result.removedBytes} bytes) in ${this.#now() - startedAt} ms`,
        )
      } catch (cause) {
        if (this.#controller.signal.aborted) return
        this.#options.logger.warn(
          `housekeeping ${task.id}@${task.revision} failed`,
          cause,
        )
      }
    }
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now()
  }
}

function taskIsDue(
  task: HousekeepingTask,
  ledger: HousekeepingLedger,
  now: number,
): boolean {
  const completed = ledger.tasks[task.id]
  if (!completed || completed.revision !== task.revision) return true
  if (task.intervalMs === null) return false
  return now - completed.succeededAt >= task.intervalMs
}

async function readLedger(path: string): Promise<HousekeepingLedger> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    const result = HousekeepingLedgerSchema.safeParse(parsed)
    if (result.success) return { version: 1, tasks: result.data.tasks }
  } catch {
    // Missing and invalid ledgers both rebuild from completed tasks.
  }
  return { version: 1, tasks: {} }
}

async function writeLedger(
  path: string,
  ledger: HousekeepingLedger,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(ledger), "utf8")
    await rename(temporaryPath, path)
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw cause
  }
}
