import {
  registerScheduledTasks,
  scheduledTaskInfoById,
  scheduledTaskInfos,
  startScheduledTasks,
  stopScheduledTasks,
  triggerScheduledTask,
  updateScheduledTaskTriggers,
} from "./manager"
import { scheduledTasks } from "./registry"

registerScheduledTasks(scheduledTasks)

export {
  scheduledTaskInfoById,
  scheduledTaskInfos,
  startScheduledTasks,
  stopScheduledTasks,
  triggerScheduledTask,
  updateScheduledTaskTriggers,
}
export type {
  ScheduledTaskInfo,
  ScheduledTaskPayload,
  ScheduledTaskResult,
  ScheduledTaskRunResponse,
  ScheduledTaskTrigger,
} from "./types"
