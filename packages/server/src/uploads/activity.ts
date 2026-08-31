import { locks } from "node:worker_threads"

export function withUploadActivity<T>(
  clipId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return locks.request(uploadLockName(clipId), { mode: "shared" }, operation)
}

export function withUploadActivityStopped<T>(
  clipId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return locks.request(uploadLockName(clipId), operation)
}

function uploadLockName(clipId: string): string {
  return `upload:${clipId.toLowerCase()}`
}
