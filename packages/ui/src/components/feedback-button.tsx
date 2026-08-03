import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import { CircleAlertIcon, CheckIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

type FeedbackState = "idle" | "pending" | "success" | "error"

type FeedbackButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  state?: FeedbackState
  children: ReactNode
  pendingLabel?: ReactNode
  successLabel?: ReactNode
  errorLabel?: ReactNode
}

/**
 * Keeps short-lived action feedback on the control that initiated it. The
 * caller owns the state so it can reflect a mutation, form submission, or a
 * longer workflow without the button hiding application errors.
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
  const feedback =
    state === "pending" ? (
      <>
        <Spinner />
        {pendingLabel ?? children}
      </>
    ) : state === "success" ? (
      <>
        <CheckIcon className="text-success" />
        {successLabel ?? children}
      </>
    ) : state === "error" ? (
      <>
        <CircleAlertIcon className="text-destructive" />
        {errorLabel ?? children}
      </>
    ) : (
      children
    )

  return (
    <Button
      data-feedback-state={state}
      aria-live="polite"
      variant={state === "success" || state === "error" ? "outline" : variant}
      className={cn(state === "success" && "disabled:opacity-100", className)}
      disabled={disabled || state === "pending" || state === "success"}
      {...props}
    >
      {feedback}
    </Button>
  )
}

export { FeedbackButton }
export type { FeedbackButtonProps, FeedbackState }
