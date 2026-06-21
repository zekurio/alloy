"use client"

import { cn } from "@alloy/ui/lib/utils"
import { Progress } from "@base-ui/react/progress"

function ProgressRoot({
  className,
  children,
  value,
  indicatorClassName,
  ...props
}: Progress.Root.Props & { indicatorClassName?: string }) {
  return (
    <Progress.Root
      value={value}
      data-slot="progress"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator className={indicatorClassName} />
      </ProgressTrack>
    </Progress.Root>
  )
}

function ProgressTrack({ className, ...props }: Progress.Track.Props) {
  return (
    <Progress.Track
      data-slot="progress-track"
      className={cn(
        "relative h-[3px] w-full overflow-hidden rounded-full bg-neutral-200",
        className,
      )}
      {...props}
    />
  )
}

function ProgressIndicator({ className, ...props }: Progress.Indicator.Props) {
  return (
    <Progress.Indicator
      data-slot="progress-indicator"
      className={cn("h-full bg-accent transition-all", className)}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: Progress.Label.Props) {
  return (
    <Progress.Label
      data-slot="progress-label"
      className={cn("text-xs font-medium text-foreground-muted", className)}
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: Progress.Value.Props) {
  return (
    <Progress.Value
      data-slot="progress-value"
      className={cn(
        "ml-auto text-2xs text-foreground-faint tabular-nums",
        className,
      )}
      {...props}
    />
  )
}

export {
  ProgressRoot as Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
}
