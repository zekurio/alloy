import type { AdminScheduledTaskTrigger } from "alloy-api"
import { toast } from "alloy-ui/lib/toast"

export const CRON_PRESETS = [
  { id: "six-hours", label: "Every 6 hours", expression: "0 */6 * * *" },
  { id: "daily", label: "Daily", expression: "0 3 * * *" },
  { id: "weekly", label: "Weekly", expression: "0 3 * * 0" },
  { id: "monthly", label: "Monthly", expression: "0 3 1 * *" },
] as const
export const CUSTOM_PRESET = "custom"
export const STARTUP_DELAY_MAX_SECONDS = 24 * 60 * 60
export const JITTER_MAX_SECONDS = 24 * 60 * 60

export type CronPresetId =
  | (typeof CRON_PRESETS)[number]["id"]
  | typeof CUSTOM_PRESET

export function copyTriggers(
  triggers: AdminScheduledTaskTrigger[],
): AdminScheduledTaskTrigger[] {
  return triggers.map((trigger) => ({ ...trigger }))
}

export function sameTriggers(
  left: AdminScheduledTaskTrigger[],
  right: AdminScheduledTaskTrigger[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function presetIdForExpression(expression: string): CronPresetId {
  return (
    CRON_PRESETS.find((preset) => preset.expression === expression)?.id ??
    CUSTOM_PRESET
  )
}

export function expressionForPreset(id: CronPresetId): string | null {
  return CRON_PRESETS.find((preset) => preset.id === id)?.expression ?? null
}

function describeTrigger(trigger: AdminScheduledTaskTrigger): string {
  if (trigger.type === "startup") {
    const seconds = Math.round((trigger.delayMs ?? 0) / 1_000)
    return seconds > 0 ? `On startup (+${seconds}s)` : "On startup"
  }
  const preset = CRON_PRESETS.find(
    (entry) => entry.expression === trigger.expression,
  )
  return preset?.label ?? (trigger.expression.trim() || "Custom cron")
}

export function summarizeTriggers(
  triggers: AdminScheduledTaskTrigger[],
): string {
  if (triggers.length === 0) return "Manual only"
  return triggers.map(describeTrigger).join(" · ")
}

export function normalizeTriggers(
  triggers: AdminScheduledTaskTrigger[],
): AdminScheduledTaskTrigger[] | null {
  const next: AdminScheduledTaskTrigger[] = []
  for (const trigger of triggers) {
    if (trigger.type === "startup") {
      next.push({
        type: "startup",
        delayMs: Math.max(0, Math.round(trigger.delayMs ?? 0)),
        jitterMs: Math.max(0, Math.round(trigger.jitterMs ?? 0)),
      })
      continue
    }

    const expression = trigger.expression.trim()
    if (!expression) {
      toast.error("Cron expression is required.")
      return null
    }
    next.push({
      type: "cron",
      expression,
      jitterMs: Math.max(0, Math.round(trigger.jitterMs ?? 0)),
    })
  }
  return next
}
