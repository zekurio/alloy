export type UploadOperation = "single" | "part" | "complete" | "cancel"
export type UploadGateMode = "activity" | "stopped"

/**
 * Parts may upload concurrently. Every terminal operation is exclusive so it
 * drains active parts and serializes the storage-to-database ownership handoff.
 */
export function uploadOperationGateMode(
  operation: UploadOperation,
): UploadGateMode {
  return operation === "part" ? "activity" : "stopped"
}
