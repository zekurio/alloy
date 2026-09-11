import { t } from "@alloy/i18n"
import { messageFromUnknown } from "@alloy/ui/lib/error-message"

export function errorMessage(cause: unknown, fallback: string): string {
  const message = messageFromUnknown(cause)
  if (message !== null) return t(message)
  return t(fallback)
}
