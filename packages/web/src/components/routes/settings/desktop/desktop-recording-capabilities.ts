import type {
  RecordingCapability,
  RecordingStatus,
} from "@alloy/contracts/desktop"

/** Whether the recorder on this host reports `capability`. */
export function recorderSupports(
  status: RecordingStatus,
  capability: RecordingCapability,
): boolean {
  return status.capabilities.includes(capability)
}
