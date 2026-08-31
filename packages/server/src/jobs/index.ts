import "./kinds/job-retention"
import "./kinds/notification-retention"
import "./kinds/storage-orphan-gc"
import "./kinds/upload-retention"
import { startDispatchers, stopDispatchers } from "./dispatcher"
import { ensureScheduled } from "./recurring"

export async function startJobs(): Promise<void> {
  await ensureScheduled()
  startDispatchers()
}

export async function stopJobs(): Promise<void> {
  await stopDispatchers()
}

export { enqueue } from "./store"
