import type {
  RecordingCapability,
  RecordingStatus,
} from "@alloy/contracts/desktop"

/**
 * Whether the recorder on this host reports `capability`. A status without
 * the list comes from a host that predates it, or was taken before the agent
 * reported in; both count as the full set, which is what Windows records with.
 */
export function recorderSupports(
  status: RecordingStatus,
  capability: RecordingCapability,
): boolean {
  const capabilities = status.capabilities
  return !capabilities?.length || capabilities.includes(capability)
}
