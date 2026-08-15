"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster } from "sonner"
import type { ToasterProps } from "sonner"

import { cssVariables } from "../lib/css-properties"

const AlloyToaster = ({ ...props }: ToasterProps) => {
  return (
    <Toaster
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
      style={cssVariables({
        "--normal-bg": "var(--surface-raised)",
        "--normal-text": "var(--foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius-md)",
        "--width": "380px",
        fontFamily: "var(--font-sans)",
      })}
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

export { AlloyToaster as Toaster }
