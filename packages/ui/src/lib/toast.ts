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
    "Close",
  )
}

function withCloseAction(
  id: string | number,
  data?: ExternalToast,
): ExternalToast {
  const action = data?.action
  return {
    ...data,
    id,
    action: action ?? getCloseAction(id),
    cancel: action ? getCloseAction(id) : undefined,
    closeButton: false,
  }
}

const alloyToast = Object.assign(
  (message: ReactNode, data?: ExternalToast) => {
    const id = getToastId(data?.id)
    return toast(message, withCloseAction(id, data))
  },
  {
    success: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.success(message, withCloseAction(id, data))
    },
    info: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.info(message, withCloseAction(id, data))
    },
    warning: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.warning(message, withCloseAction(id, data))
    },
    error: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.error(message, withCloseAction(id, data))
    },
    custom: toast.custom,
    message: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.message(message, withCloseAction(id, data))
    },
    promise: toast.promise,
    dismiss: toast.dismiss,
    loading: (message: ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return toast.loading(message, withCloseAction(id, data))
    },
    getHistory: toast.getHistory,
    getToasts: toast.getToasts,
  },
)

export { alloyToast as toast }
