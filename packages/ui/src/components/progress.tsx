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

export { ProgressRoot as Progress }
