import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import type { RecordingHudState } from "../shared/ipc"

import "./styles.css"
import "./recording-hud.css"

function RecordingHudApp() {
  const [state, setState] = useState<RecordingHudState | null>(null)

  useEffect(() => window.alloyRecordingHud.onState(setState), [])

  const Icon =
    state?.kind === "saved"
      ? CheckCircle2Icon
      : state?.kind === "error"
        ? CircleAlertIcon
        : null

  return (
    <main
      className={cn(
        "flex h-full w-full items-center justify-end transition-opacity duration-150",
        state ? "opacity-100" : "opacity-0",
      )}
      aria-live="polite"
    >
      <div
        className={cn(
          "mr-0 flex h-[60px] w-[284px] items-center gap-3 rounded-md border px-3.5",
          "bg-surface/95 text-foreground shadow-[0_18px_48px_-20px_rgb(0_0_0_/_0.9)]",
          "border-border",
          state?.kind === "saved" &&
            "border-[oklch(0.72_0.19_145/0.35)] bg-[color-mix(in_oklab,var(--surface)_94%,oklch(0.72_0.19_145)_6%)]",
          state?.kind === "error" &&
            "border-[oklch(0.65_0.24_25/0.4)] bg-[color-mix(in_oklab,var(--surface)_92%,var(--danger)_8%)]",
        )}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md bg-surface-raised text-foreground-muted",
            state?.kind === "saving" && "text-accent",
            state?.kind === "saved" && "text-success",
            state?.kind === "error" && "text-danger",
          )}
        >
          {state?.kind === "saving" ? (
            <Spinner />
          ) : Icon ? (
            <Icon className="size-4" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {state?.title ?? "Recording"}
          </span>
          {state?.detail ? (
            <span className="text-foreground-dim mt-0.5 block truncate text-xs">
              {state.detail}
            </span>
          ) : null}
        </span>
      </div>
    </main>
  )
}

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

createRoot(container).render(
  <StrictMode>
    <RecordingHudApp />
  </StrictMode>,
)
