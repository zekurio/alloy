import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { animateWithMotionTokens } from "@alloy/ui/lib/motion"
import { cn } from "@alloy/ui/lib/utils"
import { CircleAlertIcon, CheckIcon } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import type { ComponentProps, ReactNode } from "react"

type FeedbackState = "idle" | "pending" | "success" | "error"

const FEEDBACK_STATES: readonly FeedbackState[] = [
  "idle",
  "pending",
  "success",
  "error",
]

type FeedbackButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  state?: FeedbackState
  children: ReactNode
  /**
   * Shown beside a spinner while pending. Without one, the spinner covers
   * the idle label, so the button keeps its exact width.
   */
  pendingLabel?: ReactNode
  successLabel?: ReactNode
  errorLabel?: ReactNode
}

/**
 * Keeps short-lived action feedback on the control that initiated it. The
 * caller owns the state so it can reflect a mutation, form submission, or a
 * longer workflow without the button hiding application errors.
 *
 * Every state's label stays mounted and crossfades. Only the active one is
 * laid out, and the button eases between the old and new label's width
 * instead of jumping, so a longer "Saving…" never shoves its neighbours.
 */
function FeedbackButton({
  state = "idle",
  children,
  pendingLabel,
  successLabel,
  errorLabel,
  variant,
  className,
  disabled,
  ...props
}: FeedbackButtonProps) {
  // A filled button already carries its state in the fill; tinting its icon
  // would fight the label colour.
  const tinted =
    variant !== undefined &&
    variant !== null &&
    variant !== "primary" &&
    variant !== "default" &&
    variant !== "destructive"
  const labels = {
    idle: children,
    pending:
      pendingLabel === undefined ? (
        <>
          <span className="invisible contents">{children}</span>
          <Spinner className="absolute inset-0 m-auto" />
        </>
      ) : (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ),
    success: (
      <>
        <CheckIcon className={tinted ? "text-success" : undefined} />
        {successLabel ?? children}
      </>
    ),
    error: (
      <>
        <CircleAlertIcon className={tinted ? "text-destructive" : undefined} />
        {errorLabel ?? children}
      </>
    ),
  } satisfies Record<FeedbackState, ReactNode>

  const layersRef = useRef<HTMLSpanElement>(null)
  const shownStateRef = useRef(state)
  const resizeRef = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const previous = shownStateRef.current
    shownStateRef.current = state
    const layers = layersRef.current
    if (!layers || previous === state) return
    // offsetWidth is the layout width, so an ancestor's open animation
    // scaling the button can't skew it. A resize still running starts the
    // next one from wherever it got to.
    const running = resizeRef.current?.playState === "running"
    const from = running
      ? layers.offsetWidth
      : layerWidth(layers, FEEDBACK_STATES.indexOf(previous))
    resizeRef.current?.cancel()
    resizeRef.current = null
    const to = layerWidth(layers, FEEDBACK_STATES.indexOf(state))
    // A hidden button measures 0; there is nothing to ease.
    if (!from || !to || from === to) return
    resizeRef.current = animateWithMotionTokens(layers, {
      width: [`${from}px`, `${to}px`],
    })
  }, [state])

  return (
    <Button
      data-feedback-state={state}
      aria-live="polite"
      variant={variant}
      className={cn(
        "overflow-hidden",
        (state === "pending" || state === "success") && "disabled:opacity-100",
        className,
      )}
      disabled={disabled || state === "pending" || state === "success"}
      {...props}
    >
      <span ref={layersRef} className="relative inline-flex justify-center">
        {FEEDBACK_STATES.map((layerState) => (
          <span
            key={layerState}
            aria-hidden={layerState !== state || undefined}
            className={cn(
              "inline-flex items-center justify-center gap-2",
              "transition-[opacity,visibility] duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
              layerState === state
                ? "relative"
                : "invisible absolute top-1/2 left-1/2 w-max -translate-x-1/2 -translate-y-1/2 opacity-0",
            )}
          >
            {labels[layerState]}
          </span>
        ))}
      </span>
    </Button>
  )
}

function layerWidth(layers: HTMLElement, index: number): number {
  const layer = layers.children[index]
  return layer instanceof HTMLElement ? layer.offsetWidth : 0
}

export { FeedbackButton }
export type { FeedbackButtonProps }
