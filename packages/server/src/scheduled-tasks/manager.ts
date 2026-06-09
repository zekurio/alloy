import { hostname } from "node:os"

import { logger } from "alloy-logging"

import { configStore } from "../config/store"
import { errorMessage, isAbortError } from "../runtime/error-message"
import { createScheduledCronJob, type ScheduledCronJob } from "./cron"
import {
  acquireScheduledTaskLock,
  cancelExpiredScheduledTaskRuns,
  createScheduledTaskRun,
  finishScheduledTaskRun,
  heartbeatScheduledTaskLock,
  latestScheduledTaskRuns,
  releaseScheduledTaskLock,
  type PersistedScheduledTaskRun,
} from "./persistence"
import type {
  ScheduledTask,
  ScheduledTaskInfo,
  ScheduledTaskPayload,
  ScheduledTaskResult,
  ScheduledTaskRunResponse,
  ScheduledTaskRunTrigger,
  ScheduledTaskTrigger,
} from "./types"

const TASK_RUNNER_ID = `${hostname()}:${process.pid}:${crypto.randomUUID()}`
const LOCK_TTL_MS = 90_000
const LOCK_HEARTBEAT_MS = 30_000

type RunningTask = {
  controller: AbortController
  promise: Promise<void>
  runId: string
  startedAt: Date
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
}

type QueuedTask = {
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
}

type TaskState = {
  running: RunningTask | null
  queued: QueuedTask | null
}

type ScheduledTimer = {
  taskId: string
  timer: ReturnType<typeof setTimeout>
}

type CronSchedule = {
  taskId: string
  job: ScheduledCronJob
}

const tasks = new Map<string, ScheduledTask>()
const states = new Map<string, TaskState>()
let runTimers: ScheduledTimer[] = []
let cronSchedules: CronSchedule[] = []
let started = false

configStore.subscribe((next, prev) => {
  if (sameTriggersConfig(next.scheduledTasks, prev.scheduledTasks)) return
  rescheduleAllTasks()
})

export function registerScheduledTasks(nextTasks: ScheduledTask[]): void {
  if (started) throw new Error("Scheduled tasks are already running")
  tasks.clear()
  states.clear()
  for (const task of nextTasks) {
    if (tasks.has(task.id)) {
      throw new Error(`Duplicate scheduled task id: ${task.id}`)
    }
    tasks.set(task.id, task)
    states.set(task.id, emptyTaskState())
  }
}

export function startScheduledTasks(): void {
  if (started) return
  started = true
  void cancelExpiredScheduledTaskRuns().catch((err) => {
    logger.warn("[scheduled-tasks] failed to cancel stale task runs:", err)
  })
  for (const task of tasks.values()) {
    scheduleTaskTriggers(task, true)
  }
}

export async function stopScheduledTasks(): Promise<void> {
  if (!started) return
  started = false
  clearAllSchedules()
  const running = [...states.values()]
    .map((state) => state.running)
    .filter((entry): entry is RunningTask => entry !== null)
  for (const state of states.values()) state.queued = null
  for (const entry of running) entry.controller.abort()
  await Promise.allSettled(running.map((entry) => entry.promise))
}

export async function scheduledTaskInfos(): Promise<ScheduledTaskInfo[]> {
  await cancelExpiredScheduledTaskRuns()
  const allTasks = [...tasks.values()]
  const latestRuns = await latestScheduledTaskRuns(
    allTasks.map((task) => task.id),
  )
  return allTasks
    .map((task) => scheduledTaskInfo(task, latestRuns.get(task.id) ?? null))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function scheduledTaskInfoById(
  id: string,
): Promise<ScheduledTaskInfo | null> {
  const task = tasks.get(id)
  if (!task) return null
  return scheduledTaskInfoForTask(task)
}

export async function triggerScheduledTask(
  id: string,
  payload: ScheduledTaskPayload | null,
): Promise<ScheduledTaskRunResponse | null> {
  const task = tasks.get(id)
  if (!task) return null
  const startedRun = await runTask(task, "manual", payload)
  return {
    ...startedRun,
    task: await scheduledTaskInfoForTask(task),
  }
}

export async function updateScheduledTaskTriggers(
  id: string,
  triggers: ScheduledTaskTrigger[],
): Promise<ScheduledTaskInfo | null> {
  const task = tasks.get(id)
  if (!task) return null

  const scheduledTasks = { ...configStore.get("scheduledTasks") }
  if (sameTriggers(triggers, task.triggers)) {
    delete scheduledTasks[id]
  } else {
    scheduledTasks[id] = triggers
  }
  configStore.set("scheduledTasks", scheduledTasks)

  return scheduledTaskInfoForTask(task)
}

function effectiveTriggers(task: ScheduledTask): ScheduledTaskTrigger[] {
  return configStore.get("scheduledTasks")[task.id] ?? task.triggers
}

function rescheduleAllTasks(): void {
  clearAllSchedules()
  if (!started) return
  for (const task of tasks.values()) {
    scheduleTaskTriggers(task, false)
  }
}

function scheduleTaskTriggers(
  task: ScheduledTask,
  includeStartup: boolean,
): void {
  for (const trigger of effectiveTriggers(task)) {
    if (trigger.type === "startup" && !includeStartup) continue
    scheduleTrigger(task, trigger)
  }
}

function scheduleTrigger(
  task: ScheduledTask,
  trigger: ScheduledTaskTrigger,
): void {
  if (trigger.type === "startup") {
    scheduleDelayedRun(
      task,
      "startup",
      delayWithJitter(trigger.delayMs ?? 0, trigger.jitterMs),
    )
    return
  }

  const job = createScheduledCronJob(trigger.expression, () => {
    if (!started) return
    scheduleDelayedRun(task, "cron", delayWithJitter(0, trigger.jitterMs))
  })
  cronSchedules.push({ taskId: task.id, job })
}

function clearAllSchedules(): void {
  for (const entry of runTimers) clearTimeout(entry.timer)
  runTimers = []
  for (const entry of cronSchedules) entry.job.stop()
  cronSchedules = []
}

function scheduleDelayedRun(
  task: ScheduledTask,
  trigger: ScheduledTaskRunTrigger,
  delayMs: number,
): void {
  const timer = setTimeout(() => {
    runTimers = runTimers.filter((entry) => entry.timer !== timer)
    if (started) {
      void runTask(task, trigger, null).catch((err) => {
        logger.error(`[scheduled-tasks] ${task.id} failed to start:`, err)
      })
    }
  }, delayMs)
  runTimers.push({ taskId: task.id, timer })
}

async function runTask(
  task: ScheduledTask,
  trigger: ScheduledTaskRunTrigger,
  payload: ScheduledTaskPayload | null,
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
    if (started && queued) {
      void runTask(task, queued.trigger, queued.payload).catch((err) => {
        logger.error(`[scheduled-tasks] ${task.id} queued run failed:`, err)
      })
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

async function scheduledTaskInfoForTask(
  task: ScheduledTask,
): Promise<ScheduledTaskInfo> {
  await cancelExpiredScheduledTaskRuns()
  const latestRuns = await latestScheduledTaskRuns([task.id])
  return scheduledTaskInfo(task, latestRuns.get(task.id) ?? null)
}

function scheduledTaskInfo(
  task: ScheduledTask,
  latestRun: PersistedScheduledTaskRun | null,
): ScheduledTaskInfo {
  const state = stateFor(task.id)
  const running = state.running
  const remoteRunning = !running && latestRun?.status === "running"
  const runStartedAt = running?.startedAt ?? latestRun?.startedAt ?? null
  const lastStatus =
    latestRun && latestRun.status !== "running" ? latestRun.status : null
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    triggers: effectiveTriggers(task),
    state: running || remoteRunning ? "running" : "idle",
    currentTrigger:
      running?.trigger ?? (remoteRunning ? (latestRun?.trigger ?? null) : null),
    lastStartedAt: runStartedAt?.toISOString() ?? null,
    lastFinishedAt:
      running || remoteRunning
        ? null
        : (latestRun?.finishedAt?.toISOString() ?? null),
    lastDurationMs:
      running || remoteRunning ? null : (latestRun?.durationMs ?? null),
    lastStatus: running || remoteRunning ? null : lastStatus,
    lastError: running || remoteRunning ? null : (latestRun?.error ?? null),
    lastResult: running || remoteRunning ? null : (latestRun?.result ?? null),
  }
}

function stateFor(taskId: string): TaskState {
  const state = states.get(taskId)
  if (!state) throw new Error(`Unknown scheduled task state: ${taskId}`)
  return state
}

function emptyTaskState(): TaskState {
  return {
    running: null,
    queued: null,
  }
}

function delayWithJitter(baseMs: number, jitterMs: number | undefined): number {
  if (!jitterMs || jitterMs <= 0) return baseMs
  return baseMs + Math.floor(Math.random() * (jitterMs + 1))
}

function sameTriggers(
  left: ScheduledTaskTrigger[],
  right: ScheduledTaskTrigger[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameTriggersConfig(
  left: Record<string, ScheduledTaskTrigger[]>,
  right: Record<string, ScheduledTaskTrigger[]>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
