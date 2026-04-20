"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, toast } from "sonner"
import type { ToasterProps } from "sonner"

/**
 * Alloy-flavoured Sonner wrapper.
 *
 * Matches the mock in `@alloy/ui > toast.tsx`: a raised card where the
 * type (success / info / warning / error / loading) is conveyed by the
 * icon color. Description sits on a muted second line, an inline-end
 * close button takes the place of sonner's default cross.
 *
 * The app is dark-only for now, so `theme` is pinned to `dark` — no
 * `next-themes` dependency required. Visuals are driven by CSS custom
 * properties in `globals.css` (search `Sonner / Alloy toasts`) so the
 * component stays a thin pass-through.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      offset={24}
      gap={10}
      visibleToasts={5}
      closeButton
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
          closeButton: "alloy-toast-close",
          actionButton: "alloy-toast-action",
          cancelButton: "alloy-toast-cancel",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
