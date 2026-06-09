import { logger } from "alloy-logging"

import { configStore } from "../config/store"
import { errorMessage, isAbortError } from "../runtime/error-message"
import { createScheduledCronJob, type ScheduledCronJob } from "./cron"
import type {
  ScheduledTask,
  ScheduledTaskInfo,
  ScheduledTaskResult,
  ScheduledTaskRunResponse,
  ScheduledTaskRunTrigger,
  ScheduledTaskTrigger,
} from "./types"

type RunningTask = {
  controller: AbortController
  promise: Promise<void>
  trigger: ScheduledTaskRunTrigger
}

type TaskState = {
  running: RunningTask | null
  lastStartedAt: Date | null
  lastFinishedAt: Date | null
  lastDurationMs: number | null
  lastStatus: "success" | "failed" | "cancelled" | null
  lastError: string | null
  lastResult: ScheduledTaskResult | null
}

type StartupTimer = {
  taskId: string
  timer: ReturnType<typeof setTimeout>
}

type CronSchedule = {
  taskId: string
  job: ScheduledCronJob
}

const tasks = new Map<string, ScheduledTask>()
const states = new Map<string, TaskState>()
let startupTimers: StartupTimer[] = []
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
  for (const entry of running) entry.controller.abort()
  await Promise.allSettled(running.map((entry) => entry.promise))
}

export function scheduledTaskInfos(): ScheduledTaskInfo[] {
  return [...tasks.values()]
    .map((task) => scheduledTaskInfo(task))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function scheduledTaskInfoById(id: string): ScheduledTaskInfo | null {
  const task = tasks.get(id)
  return task ? scheduledTaskInfo(task) : null
}

export function triggerScheduledTask(
  id: string,
): ScheduledTaskRunResponse | null {
  const task = tasks.get(id)
  if (!task) return null
  const startedRun = runTask(task, "manual")
  return {
    started: startedRun,
    task: scheduledTaskInfo(task),
  }
}

export function updateScheduledTaskTriggers(
  id: string,
  triggers: ScheduledTaskTrigger[],
): ScheduledTaskInfo | null {
  const task = tasks.get(id)
  if (!task) return null

  const scheduledTasks = { ...configStore.get("scheduledTasks") }
  if (sameTriggers(triggers, task.triggers)) {
    delete scheduledTasks[id]
  } else {
    scheduledTasks[id] = triggers
  }
  configStore.set("scheduledTasks", scheduledTasks)

  return scheduledTaskInfo(task)
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
    const timer = setTimeout(() => {
      startupTimers = startupTimers.filter((entry) => entry.timer !== timer)
      if (started) runTask(task, "startup")
    }, trigger.delayMs ?? 0)
    startupTimers.push({ taskId: task.id, timer })
    return
  }

  const job = createScheduledCronJob(trigger.expression, () => {
    if (started) runTask(task, "cron")
  })
  cronSchedules.push({ taskId: task.id, job })
}

function clearAllSchedules(): void {
  for (const entry of startupTimers) clearTimeout(entry.timer)
  startupTimers = []
  for (const entry of cronSchedules) entry.job.stop()
  cronSchedules = []
}

function runTask(
  task: ScheduledTask,
  trigger: ScheduledTaskRunTrigger,
): boolean {
  const state = stateFor(task.id)
  if (state.running) return false

  const controller = new AbortController()
  const startedAt = new Date()
  state.lastStartedAt = startedAt
  state.lastFinishedAt = null
  state.lastDurationMs = null
  state.lastStatus = null
  state.lastError = null
  state.lastResult = null

  const promise = task
    .run({ signal: controller.signal, trigger })
    .then((result) => {
      state.lastStatus = "success"
      state.lastResult = result
      logger.info(`[scheduled-tasks] ${task.id} completed`)
    })
    .catch((err: unknown) => {
      if (isAbortError(err) || controller.signal.aborted) {
        state.lastStatus = "cancelled"
        state.lastError = errorMessage(err, "Scheduled task cancelled")
        logger.warn(`[scheduled-tasks] ${task.id} cancelled`)
        return
      }
      state.lastStatus = "failed"
      state.lastError = errorMessage(err, "Scheduled task failed")
      logger.error(`[scheduled-tasks] ${task.id} failed:`, err)
    })
    .finally(() => {
      state.lastFinishedAt = new Date()
      state.lastDurationMs =
        state.lastFinishedAt.getTime() - startedAt.getTime()
      state.running = null
    })

  state.running = { controller, promise, trigger }
  logger.info(`[scheduled-tasks] ${task.id} started (${trigger})`)
  return true
}

function scheduledTaskInfo(task: ScheduledTask): ScheduledTaskInfo {
  const state = stateFor(task.id)
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    triggers: effectiveTriggers(task),
    state: state.running ? "running" : "idle",
    currentTrigger: state.running?.trigger ?? null,
    lastStartedAt: state.lastStartedAt?.toISOString() ?? null,
    lastFinishedAt: state.lastFinishedAt?.toISOString() ?? null,
    lastDurationMs: state.lastDurationMs,
    lastStatus: state.lastStatus,
    lastError: state.lastError,
    lastResult: state.lastResult,
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
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastStatus: null,
    lastError: null,
    lastResult: null,
  }
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
