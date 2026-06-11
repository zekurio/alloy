import type { ScheduledTaskTrigger } from "./types"

/**
 * Standard trigger pair for maintenance tasks: run once shortly after startup,
 * then on a recurring cron schedule, both with jitter to avoid thundering
 * herds.
 */
export function startupAndCronTriggers(opts: {
  startupDelayMs: number
  startupJitterMs: number
  cronExpression: string
  cronJitterMs: number
}): ScheduledTaskTrigger[] {
  return [
    {
      type: "startup",
      delayMs: opts.startupDelayMs,
      jitterMs: opts.startupJitterMs,
    },
    {
      type: "cron",
      expression: opts.cronExpression,
      jitterMs: opts.cronJitterMs,
    },
  ]
}
