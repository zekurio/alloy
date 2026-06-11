import type { ScheduledTaskTrigger } from "./types"

/**
 * Standard trigger pair for maintenance tasks: run once shortly after startup,
 * then on a recurring cron schedule.
 */
export function startupAndCronTriggers(opts: {
  startupDelayMs: number
  cronExpression: string
}): ScheduledTaskTrigger[] {
  return [
    {
      type: "startup",
      delayMs: opts.startupDelayMs,
    },
    {
      type: "cron",
      expression: opts.cronExpression,
    },
  ]
}
