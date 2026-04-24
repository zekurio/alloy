"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Toaster as Sonner, toast as sonnerToast } from "sonner"
import type { ExternalToast, ToasterProps } from "sonner"

let toastCounter = 0

function getToastId(id?: ExternalToast["id"]) {
  if (id !== undefined) return id
  toastCounter += 1
  return `alloy-toast-${toastCounter}`
}

function getCloseAction(id: string | number) {
  return (
    <Button size="sm" onClick={() => sonnerToast.dismiss(id)}>
      Close
    </Button>
  )
}

function withCloseAction(id: string | number, data?: ExternalToast): ExternalToast {
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

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      offset={24}
      gap={10}
      visibleToasts={5}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface-raised)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
          "--width": "380px",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "alloy-toast",
          title: "alloy-toast-title",
          description: "alloy-toast-description",
          icon: "alloy-toast-icon",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
