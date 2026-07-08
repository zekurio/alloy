import type { JobQueue } from "@alloy/contracts"
import type { JobStatus } from "@alloy/db/schema"

export interface JobEvent {
  jobId: string
  kind: string
  status: JobStatus
  progress: number
  stage: string | null
}

const jobSubscribers = new Set<(event: JobEvent) => void>()
const queueWakeSubscribers = new Set<(queue: JobQueue) => void>()

export function publishJobEvent(event: JobEvent): void {
  for (const handler of jobSubscribers) handler(event)
}

export function subscribeToJobEvents(handler: (event: JobEvent) => void) {
  jobSubscribers.add(handler)
  return () => jobSubscribers.delete(handler)
}

export function publishQueueWake(queue: JobQueue): void {
  for (const handler of queueWakeSubscribers) handler(queue)
}

export function subscribeToQueueWake(handler: (queue: JobQueue) => void) {
  queueWakeSubscribers.add(handler)
  return () => queueWakeSubscribers.delete(handler)
}
