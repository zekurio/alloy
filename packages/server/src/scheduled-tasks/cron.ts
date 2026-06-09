import { Cron } from "croner"

const CRON_OPTIONS = {
  mode: "5-part" as const,
  unref: true,
}

export type ScheduledCronJob = Cron

export function isValidCronExpression(expression: string): boolean {
  try {
    new Cron(expression, { ...CRON_OPTIONS, paused: true })
    return true
  } catch {
    return false
  }
}

export function createScheduledCronJob(
  expression: string,
  run: () => void,
): ScheduledCronJob {
  return new Cron(expression, CRON_OPTIONS, run)
}
