import { messageFromUnknown } from "@workspace/ui/lib/error-message"

export function errorMessage(cause: unknown, fallback: string): string {
  return messageFromUnknown(cause) ?? fallback
}
