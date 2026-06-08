import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react"
import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import type { RecordingHudState } from "../shared/ipc"

import "./styles.css"
import "./recording-hud.css"

function RecordingHudApp() {
  const [state, setState] = useState<RecordingHudState | null>(null)
  const lastSoundKey = useRef<string | null>(null)

  useEffect(() => window.alloyRecordingHud.onState(setState), [])
  useEffect(() => {
    if (!state || state.kind === "saving") return
    const soundKey = `${state.kind}:${state.title}:${state.detail ?? ""}`
    if (lastSoundKey.current === soundKey) return
    lastSoundKey.current = soundKey
    void playHudTone(state.kind)
  }, [state])

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

async function playHudTone(kind: RecordingHudState["kind"]) {
  const AudioContext =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof window.AudioContext
      }
    ).webkitAudioContext
  if (!AudioContext) return

  const context = new AudioContext()
  try {
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
    gain.connect(context.destination)

    const oscillator = context.createOscillator()
    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(
      kind === "saved" ? 880 : 220,
      context.currentTime,
    )
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "saved" ? 1320 : 165,
      context.currentTime + 0.18,
    )
    oscillator.connect(gain)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
    oscillator.addEventListener("ended", () => void context.close(), {
      once: true,
    })
  } catch {
    await context.close().catch(() => undefined)
  }
}

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

createRoot(container).render(
  <StrictMode>
    <RecordingHudApp />
  </StrictMode>,
)
