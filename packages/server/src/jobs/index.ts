import "./kinds/clip-encode"
import "./kinds/auth-challenge-retention"
import "./kinds/job-retention"
import "./kinds/notification-retention"
import "./kinds/renditions-sweep"
import "./kinds/storage-orphan-gc"
import "./kinds/upload-retention"
import "./kinds/webhook-deliver"
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
