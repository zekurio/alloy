import type { RecordingStatus } from "@alloy/contracts"

let lastRecordingStatus: RecordingStatus | null = null

export function getLastRecordingStatus(): RecordingStatus | null {
  return lastRecordingStatus
}

export function rememberRecordingStatus(status: RecordingStatus): void {
  lastRecordingStatus = status
}
