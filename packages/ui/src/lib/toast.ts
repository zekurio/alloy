import { isStringValue } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import type { ReactNode } from "react"
import { type ExternalToast, toast } from "sonner"

let toastCounter = 0

function getToastId(id?: ExternalToast["id"]) {
  if (id !== undefined) return id
  toastCounter += 1
  return `alloy-toast-${toastCounter}`
}

function withToastDefaults(
  id: string | number,
  data?: ExternalToast,
): ExternalToast {
  return {
    ...data,
    description: isStringValue(data?.description)
      ? t(data.description)
      : data?.description,
    id,
    // Closing is always the round corner dismiss button, and a caller-provided
    // action stays the toast's only inline button.
    cancel: undefined,
    closeButton: true,
  }
}

const alloyToast = Object.assign(
  (message: ReactNode, data?: ExternalToast) => {
    const id = getToastId(data?.id)
    return toast(
      isStringValue(message) ? t(message) : message,
      withToastDefaults(id, data),
    )
  },
  {
    success: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.success(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    info: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.info(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    warning: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.warning(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    error: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.error(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    custom: toast.custom,
    message: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.message(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    promise: toast.promise,
    dismiss: toast.dismiss,
    loading: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.loading(
        isStringValue(message) ? t(message) : message,
        withToastDefaults(id, data),
      )
    },
    getHistory: toast.getHistory,
    getToasts: toast.getToasts,
  },
)

export { alloyToast as toast }
