"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Progress — 3px-tall bar, accent fill. Used in the upload queue
 * and anywhere else we need to signal upload/render progress.
 *
 * `indicatorClassName` lets callers re-tone the fill (e.g. the queue
 * modal swaps to warning/success/destructive per row status) without
 * having to drop down to the primitive parts. `tailwind-merge` resolves
 * the conflicting `bg-*`/`duration-*`/etc. so later classes win.
 */
function Progress({
  className,
  children,
  value,
  indicatorClassName,
  ...props
}: ProgressPrimitive.Root.Props & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator className={indicatorClassName} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn(
        "relative h-[3px] w-full overflow-hidden rounded-full bg-neutral-200",
        className
      )}
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full bg-accent transition-all", className)}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      data-slot="progress-label"
      className={cn("text-xs font-medium text-foreground-muted", className)}
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      data-slot="progress-value"
      className={cn(
        "ml-auto font-mono text-2xs text-foreground-faint tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
