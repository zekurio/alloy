import * as React from "react"
import { toast as sonnerToast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import type { ExternalToast } from "sonner"

let toastCounter = 0

function getToastId(id?: ExternalToast["id"]) {
  if (id !== undefined) return id
  toastCounter += 1
  return `alloy-toast-${toastCounter}`
}

function getCloseAction(id: string | number) {
  return React.createElement(
    Button,
    { size: "sm", onClick: () => sonnerToast.dismiss(id) },
    "Close"
  )
}

function withCloseAction(
  id: string | number,
  data?: ExternalToast
): ExternalToast {
  return {
    ...data,
    id,
    action: getCloseAction(id),
    cancel: undefined,
    closeButton: false,
  }
}

const toast = Object.assign(
  (message: React.ReactNode, data?: ExternalToast) => {
    const id = getToastId(data?.id)
    return sonnerToast(message, withCloseAction(id, data))
  },
  {
    success: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.success(message, withCloseAction(id, data))
    },
    info: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.info(message, withCloseAction(id, data))
    },
    warning: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.warning(message, withCloseAction(id, data))
    },
    error: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.error(message, withCloseAction(id, data))
    },
    custom: sonnerToast.custom,
    message: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.message(message, withCloseAction(id, data))
    },
    promise: sonnerToast.promise,
    dismiss: sonnerToast.dismiss,
    loading: (message: React.ReactNode, data?: ExternalToast) => {
      const id = getToastId(data?.id)
      return sonnerToast.loading(message, withCloseAction(id, data))
    },
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  }
)

export { toast }
