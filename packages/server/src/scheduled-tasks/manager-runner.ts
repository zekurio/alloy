import { hostname } from "node:os"

import { logger } from "@alloy/logging"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"

import { stateFor, type TaskState } from "./manager-state"
import {
  acquireScheduledTaskLock,
  createScheduledTaskRun,
  finishScheduledTaskRun,
  heartbeatScheduledTaskLock,
  releaseScheduledTaskLock,
} from "./persistence"
import type {
  ScheduledTask,
  ScheduledTaskPayload,
  ScheduledTaskResult,
  ScheduledTaskRunTrigger,
} from "./types"

const TASK_RUNNER_ID = `${hostname()}:${process.pid}:${crypto.randomUUID()}`
const LOCK_TTL_MS = 90_000
const LOCK_HEARTBEAT_MS = 30_000

export async function runTask(
  task: ScheduledTask,
  trigger: ScheduledTaskRunTrigger,
  payload: ScheduledTaskPayload | null,
  isStarted: () => boolean,
): Promise<{ started: boolean; queued: boolean }> {
  const state = stateFor(task.id)
  if (state.running) return queueOrSkip(task, state, trigger, payload)

  const runId = crypto.randomUUID()
  const locked = await acquireScheduledTaskLock({
    taskId: task.id,
    ownerId: TASK_RUNNER_ID,
    runId,
    ttlMs: LOCK_TTL_MS,
  })
  if (!locked) {
    logger.info(`[scheduled-tasks] ${task.id} skipped (${trigger}); locked`)
    return { started: false, queued: false }
  }

  const startedAt = new Date()
  const controller = new AbortController()
  let timedOut = false
  let lockLost = false
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  if (task.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      controller.abort(
        new DOMException(
          `Scheduled task timed out after ${task.timeoutMs} ms`,
          "AbortError",
        ),
      )
    }, task.timeoutMs)
  }

  const stopHeartbeat = startLockHeartbeat(task.id, runId, controller, () => {
    lockLost = true
  })

  try {
    await createScheduledTaskRun({
      id: runId,
      taskId: task.id,
      trigger,
      payload,
      startedAt,
    })
  } catch (err) {
    stopHeartbeat()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    await releaseLockBestEffort(task.id, runId)
    throw err
  }

  const promise = runTaskInner({
    task,
    trigger,
    payload,
    runId,
    startedAt,
    controller,
    timedOut: () => timedOut,
    lockLost: () => lockLost,
  }).finally(async () => {
    stopHeartbeat()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    await releaseLockBestEffort(task.id, runId)
    state.running = null
    const queued = state.queued
    state.queued = null
    if (isStarted() && queued) {
      void runTask(task, queued.trigger, queued.payload, isStarted).catch(
        (err) => {
          logger.error(`[scheduled-tasks] ${task.id} queued run failed:`, err)
        },
      )
    }
  })

  state.running = { controller, promise, runId, startedAt, trigger, payload }
  logger.info(`[scheduled-tasks] ${task.id} started (${trigger})`)
  return { started: true, queued: false }
}

async function runTaskInner({
  task,
  trigger,
  payload,
  runId,
  startedAt,
  controller,
  timedOut,
  lockLost,
}: {
  task: ScheduledTask
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
  runId: string
  startedAt: Date
  controller: AbortController
  timedOut: () => boolean
  lockLost: () => boolean
}): Promise<void> {
  try {
    const result = await task.run({
      signal: controller.signal,
      trigger,
      payload,
    })
    await finishRun({
      taskId: task.id,
      runId,
      startedAt,
      status: "success",
      result,
      error: null,
    })
    logger.info(`[scheduled-tasks] ${task.id} completed`)
  } catch (err: unknown) {
    if (timedOut()) {
      await finishRun({
        taskId: task.id,
        runId,
        startedAt,
        status: "failed",
        result: null,
        error: `Scheduled task timed out after ${task.timeoutMs} ms`,
      })
      logger.error(`[scheduled-tasks] ${task.id} timed out`)
      return
    }
    if (lockLost()) {
      await finishRun({
        taskId: task.id,
        runId,
        startedAt,
        status: "cancelled",
        result: null,
        error: "Scheduled task lock was lost.",
      })
      logger.warn(`[scheduled-tasks] ${task.id} cancelled; lock lost`)
      return
    }
    if (isAbortError(err) || controller.signal.aborted) {
      await finishRun({
        taskId: task.id,
        runId,
        startedAt,
        status: "cancelled",
        result: null,
        error: errorMessage(err, "Scheduled task cancelled"),
      })
      logger.warn(`[scheduled-tasks] ${task.id} cancelled`)
      return
    }
    await finishRun({
      taskId: task.id,
      runId,
      startedAt,
      status: "failed",
      result: null,
      error: errorMessage(err, "Scheduled task failed"),
    })
    logger.error(`[scheduled-tasks] ${task.id} failed:`, err)
  }
}

async function finishRun(input: {
  taskId: string
  runId: string
  startedAt: Date
  status: "success" | "failed" | "cancelled"
  result: ScheduledTaskResult | null
  error: string | null
}): Promise<void> {
  const finishedAt = new Date()
  try {
    await finishScheduledTaskRun({
      id: input.runId,
      status: input.status,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
      result: input.result,
      error: input.error,
    })
  } catch (err) {
    logger.error(
      `[scheduled-tasks] failed to persist ${input.taskId} run result:`,
      err,
    )
  }
}

function startLockHeartbeat(
  taskId: string,
  runId: string,
  controller: AbortController,
  onLost: () => void,
): () => void {
  let pending = false
  const beat = () => {
    if (pending || controller.signal.aborted) return
    pending = true
    heartbeatScheduledTaskLock({
      taskId,
      ownerId: TASK_RUNNER_ID,
      runId,
      ttlMs: LOCK_TTL_MS,
    })
      .then((ok) => {
        if (ok) return
        onLost()
        controller.abort(
          new DOMException("Scheduled task lock was lost", "AbortError"),
        )
      })
      .catch((err: unknown) => {
        logger.error(`[scheduled-tasks] ${taskId} lock heartbeat failed:`, err)
        onLost()
        controller.abort(
          new DOMException(
            "Scheduled task lock heartbeat failed",
            "AbortError",
          ),
        )
      })
      .finally(() => {
        pending = false
      })
  }
  const timer = setInterval(beat, LOCK_HEARTBEAT_MS)
  return () => clearInterval(timer)
}

async function releaseLockBestEffort(
  taskId: string,
  runId: string,
): Promise<void> {
  try {
    await releaseScheduledTaskLock({
      taskId,
      ownerId: TASK_RUNNER_ID,
      runId,
    })
  } catch (err) {
    logger.warn(`[scheduled-tasks] ${taskId} failed to release lock:`, err)
  }
}

function queueOrSkip(
  task: ScheduledTask,
  state: TaskState,
  trigger: ScheduledTaskRunTrigger,
  payload: ScheduledTaskPayload | null,
): { started: boolean; queued: boolean } {
  if ((task.overlap ?? "skip") !== "queue-one") {
    return { started: false, queued: false }
  }
  if (state.queued) return { started: false, queued: false }
  state.queued = { trigger, payload }
  logger.info(`[scheduled-tasks] ${task.id} queued (${trigger})`)
  return { started: false, queued: true }
}
