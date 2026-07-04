import { messageFromUnknown } from "@alloy/ui/lib/error-message"

export function errorMessage(cause: unknown, fallback: string): string {
  // UI callers pass localized fallback copy for unknown thrown values.
  return messageFromUnknown(cause) ?? fallback
}
