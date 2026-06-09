import type {
  AdminScheduledTaskInfo,
  AdminScheduledTaskResult,
  AdminScheduledTaskRunResponse,
  AdminScheduledTaskRunTrigger,
  AdminScheduledTaskTrigger,
} from "alloy-contracts"

export type ScheduledTaskTrigger = AdminScheduledTaskTrigger

export type ScheduledTaskRunTrigger = AdminScheduledTaskRunTrigger

export type ScheduledTaskResult = AdminScheduledTaskResult

export type ScheduledTaskContext = {
  signal: AbortSignal
  trigger: ScheduledTaskRunTrigger
}

export type ScheduledTask = {
  id: string
  name: string
  description: string
  triggers: ScheduledTaskTrigger[]
  run: (context: ScheduledTaskContext) => Promise<ScheduledTaskResult>
}

export type ScheduledTaskInfo = AdminScheduledTaskInfo

export type ScheduledTaskRunResponse = AdminScheduledTaskRunResponse
