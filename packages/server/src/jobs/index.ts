import "./kinds/clip-encode"
import "./kinds/maintenance"
import "./kinds/notification-retention"
import "./kinds/renditions-sweep"
import "./kinds/source-probe"
import "./kinds/storage-verify"
import "./kinds/thumbnail-sweep"
import { startDispatchers, stopDispatchers } from "./dispatcher"
import { ensureScheduled } from "./recurring"
import { startJobTriggers, stopJobTriggers } from "./triggers"

export async function startJobs(): Promise<void> {
  await ensureScheduled()
  startJobTriggers()
  startDispatchers()
}

export async function stopJobs(): Promise<void> {
  stopJobTriggers()
  await stopDispatchers()
}

export { enqueue } from "./store"
