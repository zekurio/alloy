import type { ScheduledCronJob } from "./cron"
import type {
  ScheduledTask,
  ScheduledTaskPayload,
  ScheduledTaskRunTrigger,
} from "./types"

export type RunningTask = {
  controller: AbortController
  promise: Promise<void>
  runId: string
  startedAt: Date
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
}

export type QueuedTask = {
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
}

export type TaskState = {
  running: RunningTask | null
  queued: QueuedTask | null
}

export type ScheduledTimer = {
  taskId: string
  timer: ReturnType<typeof setTimeout>
}

export type CronSchedule = {
  taskId: string
  job: ScheduledCronJob
}

export const tasks = new Map<string, ScheduledTask>()
export const states = new Map<string, TaskState>()

export function stateFor(taskId: string): TaskState {
  const state = states.get(taskId)
  if (!state) throw new Error(`Unknown scheduled task state: ${taskId}`)
  return state
}

export function emptyTaskState(): TaskState {
  return {
    running: null,
    queued: null,
  }
}
