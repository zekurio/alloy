import { messageFromUnknown } from "@alloy/ui/lib/error-message"

export function errorMessage(cause: unknown, fallback: string): string {
  const message = messageFromUnknown(cause)
  if (message !== null) return message
  return fallback
}
