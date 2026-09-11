import { isStringValue } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { createElement } from "react"
import type { ReactNode } from "react"
import { type ExternalToast, toast } from "sonner"

let toastCounter = 0

function getToastId(id?: ExternalToast["id"]) {
  if (id !== undefined) return id
  toastCounter += 1
  return `alloy-toast-${toastCounter}`
}

function getCloseAction(id: string | number) {
  return createElement(
    Button,
    { size: "sm", onClick: () => toast.dismiss(id) },
    t("Close"),
  )
}

function withCloseAction(
  id: string | number,
  data?: ExternalToast,
): ExternalToast {
  const action = data?.action
  return {
    ...data,
    description: isStringValue(data?.description)
      ? t(data.description)
      : data?.description,
    id,
    action: action ?? getCloseAction(id),
    cancel: action ? getCloseAction(id) : undefined,
    closeButton: false,
  }
}

const alloyToast = Object.assign(
  (message: ReactNode, data?: ExternalToast) => {
    const id = getToastId(data?.id)
    return toast(
      isStringValue(message) ? t(message) : message,
      withCloseAction(id, data),
    )
  },
  {
    success: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.success(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    info: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.info(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    warning: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.warning(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    error: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.error(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    custom: toast.custom,
    message: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.message(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    promise: toast.promise,
    dismiss: toast.dismiss,
    loading: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.loading(
        isStringValue(message) ? t(message) : message,
        withCloseAction(id, data),
      )
    },
    getHistory: toast.getHistory,
    getToasts: toast.getToasts,
  },
)

export { alloyToast as toast }
