import type {
  AdminScheduledTaskInfo,
  AdminScheduledTaskPayload,
  AdminScheduledTaskResult,
  AdminScheduledTaskRunResponse,
  AdminScheduledTaskRunTrigger,
  AdminScheduledTaskTrigger,
} from "@alloy/contracts"

export type ScheduledTaskTrigger = AdminScheduledTaskTrigger

export type ScheduledTaskRunTrigger = AdminScheduledTaskRunTrigger

export type ScheduledTaskPayload = AdminScheduledTaskPayload

export type ScheduledTaskResult = AdminScheduledTaskResult

export type ScheduledTaskContext = {
  signal: AbortSignal
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
}

export type ScheduledTask = {
  id: string
  name: string
  description: string
  triggers: ScheduledTaskTrigger[]
  timeoutMs?: number
  overlap?: "skip" | "queue-one"
  run: (context: ScheduledTaskContext) => Promise<ScheduledTaskResult>
}

export type ScheduledTaskInfo = AdminScheduledTaskInfo

export type ScheduledTaskRunResponse = AdminScheduledTaskRunResponse
