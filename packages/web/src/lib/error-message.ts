import { messageFromUnknown } from "@alloy/contracts"
import { t } from "@alloy/i18n"

export function errorMessage(cause: unknown, fallback: string): string {
  const message = messageFromUnknown(cause)
  if (message !== null) return t(message)
  return t(fallback)
}
