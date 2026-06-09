import { logger } from "alloy-logging"

import { configStore } from "../config/store"
import { createScheduledCronJob } from "./cron"
import { runTask } from "./manager-runner"
import {
  emptyTaskState,
  stateFor,
  states,
  tasks,
  type CronSchedule,
  type RunningTask,
  type ScheduledTimer,
} from "./manager-state"
import {
  cancelExpiredScheduledTaskRuns,
  latestScheduledTaskRuns,
  type PersistedScheduledTaskRun,
} from "./persistence"
import type {
  ScheduledTask,
  ScheduledTaskInfo,
  ScheduledTaskPayload,
  ScheduledTaskRunResponse,
  ScheduledTaskRunTrigger,
  ScheduledTaskTrigger,
} from "./types"

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
  const startedRun = await runTask(task, "manual", payload, isStarted)
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
      void runTask(task, trigger, null, isStarted).catch((err) => {
        logger.error(`[scheduled-tasks] ${task.id} failed to start:`, err)
      })
    }
  }, delayMs)
  runTimers.push({ taskId: task.id, timer })
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

function isStarted(): boolean {
  return started
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
