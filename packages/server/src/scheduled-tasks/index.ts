import { clipMaintenanceTask } from "./clip-maintenance"
import {
  registerScheduledTasks,
  scheduledTaskInfoById,
  scheduledTaskInfos,
  startScheduledTasks,
  stopScheduledTasks,
  triggerScheduledTask,
  updateScheduledTaskTriggers,
} from "./manager"

registerScheduledTasks([clipMaintenanceTask])

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
  ScheduledTaskResult,
  ScheduledTaskRunResponse,
  ScheduledTaskTrigger,
} from "./types"
