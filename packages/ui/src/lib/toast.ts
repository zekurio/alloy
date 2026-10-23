import { isStringValue } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import type { ReactNode } from "react"
import { type ExternalToast, toast as sonnerToast } from "sonner"

// Most callers pass t() output, which this leaves unchanged. Raw runtime
// errors such as "Failed to fetch" also reach toasts; translating here
// localizes the ones the catalog knows.
function translateText<T>(value: T): T | string {
  return isStringValue(value) ? t(value) : value
}

function withDefaults(show: typeof sonnerToast.success) {
  return (message: ReactNode, data?: ExternalToast) =>
    show(translateText(message), {
      ...data,
      description: translateText(data?.description),
      // Closing is always the round corner dismiss button, and a caller-provided
      // action stays the toast's only inline button.
      cancel: undefined,
      closeButton: true,
    })
}

export const toast = {
  success: withDefaults(sonnerToast.success),
  info: withDefaults(sonnerToast.info),
  warning: withDefaults(sonnerToast.warning),
  error: withDefaults(sonnerToast.error),
  dismiss: sonnerToast.dismiss,
}
