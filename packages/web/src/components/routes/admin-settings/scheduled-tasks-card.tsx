import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminScheduledTaskInfo,
  AdminScheduledTaskResult,
  AdminScheduledTaskTrigger,
  AdminScheduledTasksResponse,
} from "alloy-api"
import { Button } from "alloy-ui/components/button"
import { Input } from "alloy-ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "alloy-ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "alloy-ui/components/select"
import { Spinner } from "alloy-ui/components/spinner"
import { toast } from "alloy-ui/lib/toast"
import {
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { NumberInput } from "@/components/routes/admin-settings/number-input"
import {
  adminKeys,
  adminScheduledTasksQueryOptions,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

const CRON_PRESETS = [
  { id: "six-hours", label: "Every 6 hours", expression: "0 */6 * * *" },
  { id: "daily", label: "Daily", expression: "0 3 * * *" },
  { id: "weekly", label: "Weekly", expression: "0 3 * * 0" },
  { id: "monthly", label: "Monthly", expression: "0 3 1 * *" },
] as const
const CUSTOM_PRESET = "custom"
const STARTUP_DELAY_MAX_SECONDS = 24 * 60 * 60
const JITTER_MAX_SECONDS = 24 * 60 * 60

type CronPresetId = (typeof CRON_PRESETS)[number]["id"] | typeof CUSTOM_PRESET
type Drafts = Record<string, AdminScheduledTaskTrigger[]>

function copyTriggers(
  triggers: AdminScheduledTaskTrigger[],
): AdminScheduledTaskTrigger[] {
  return triggers.map((trigger) => ({ ...trigger }))
}

function sameTriggers(
  left: AdminScheduledTaskTrigger[],
  right: AdminScheduledTaskTrigger[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function presetIdForExpression(expression: string): CronPresetId {
  return (
    CRON_PRESETS.find((preset) => preset.expression === expression)?.id ??
    CUSTOM_PRESET
  )
}

function expressionForPreset(id: CronPresetId): string | null {
  return CRON_PRESETS.find((preset) => preset.id === id)?.expression ?? null
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "Unknown"
  if (ms < 1_000) return `${ms} ms`
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} hr`
}

function humanizeResultKey(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function normalizeTriggers(
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

function setScheduledTaskCache(
  queryClient: ReturnType<typeof useQueryClient>,
  updated: AdminScheduledTaskInfo,
) {
  queryClient.setQueryData<AdminScheduledTasksResponse>(
    adminKeys.scheduledTasks(),
    (current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === updated.id ? updated : task,
            ),
          }
        : current,
  )
}

function StatusBadge({ task }: { task: AdminScheduledTaskInfo }) {
  const tone =
    task.state === "running"
      ? "border-accent-border bg-accent-soft text-accent"
      : task.lastStatus === "failed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-surface-raised text-foreground-muted"

  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium ${tone}`}
    >
      {task.state === "running" ? "Running" : (task.lastStatus ?? "Idle")}
    </span>
  )
}

function TaskResult({ result }: { result: AdminScheduledTaskResult | null }) {
  if (!result) return null
  // Keep the summary quiet: only surface metrics that actually changed
  // something, so a clean run doesn't render a wall of zeros.
  const entries = Object.entries(result).filter(
    ([, value]) => typeof value !== "number" || value !== 0,
  )
  if (entries.length === 0) {
    return <span className="text-foreground-dim text-xs">No changes</span>
  }
  return (
    <div className="text-foreground-muted flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <span key={key}>
          <span className="text-foreground-dim">{humanizeResultKey(key)}:</span>{" "}
          {String(value)}
        </span>
      ))}
    </div>
  )
}

function TriggerRow({
  id,
  index,
  trigger,
  disabled,
  onChange,
  onRemove,
}: {
  id: string
  index: number
  trigger: AdminScheduledTaskTrigger
  disabled: boolean
  onChange: (next: AdminScheduledTaskTrigger) => void
  onRemove: () => void
}) {
  const rowId = `${id}-trigger-${index}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-foreground-dim w-16 shrink-0 text-xs">
        {trigger.type === "startup" ? "Startup" : "Schedule"}
      </span>

      {trigger.type === "startup" ? (
        <div className="flex min-w-56 flex-1 items-center gap-2">
          <NumberInput
            id={`${rowId}-delay`}
            aria-label="Delay after startup (seconds)"
            className="w-24"
            min={0}
            max={STARTUP_DELAY_MAX_SECONDS}
            value={Math.round((trigger.delayMs ?? 0) / 1_000)}
            disabled={disabled}
            onChange={(value) =>
              onChange({ ...trigger, delayMs: value * 1_000 })
            }
          />
          <span className="text-foreground-dim text-xs">
            seconds after launch
          </span>
        </div>
      ) : (
        <div className="flex min-w-72 flex-1 items-center gap-2">
          <Select
            value={presetIdForExpression(trigger.expression)}
            onValueChange={(value) => {
              const expression = expressionForPreset(value as CronPresetId)
              if (expression) onChange({ ...trigger, expression })
            }}
            disabled={disabled}
          >
            <SelectTrigger id={`${rowId}-preset`} className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {CRON_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_PRESET}>Custom cron</SelectItem>
            </SelectContent>
          </Select>
          <Input
            id={`${rowId}-cron`}
            aria-label="Cron expression"
            required
            className="flex-1 font-mono"
            value={trigger.expression}
            placeholder="0 3 * * *"
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...trigger, expression: e.target.value })
            }
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-foreground-dim text-xs">Jitter</span>
        <NumberInput
          id={`${rowId}-jitter`}
          aria-label="Jitter (seconds)"
          className="w-24"
          min={0}
          max={JITTER_MAX_SECONDS}
          value={Math.round((trigger.jitterMs ?? 0) / 1_000)}
          disabled={disabled}
          onChange={(value) =>
            onChange({ ...trigger, jitterMs: value * 1_000 })
          }
        />
        <span className="text-foreground-dim text-xs">sec</span>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-foreground-dim hover:text-destructive shrink-0"
        disabled={disabled}
        onClick={onRemove}
        aria-label="Remove trigger"
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

function AddTriggerButtons({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (trigger: AdminScheduledTaskTrigger) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd({ type: "cron", expression: "0 3 * * *" })}
      >
        <PlusIcon />
        Daily
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd({ type: "cron", expression: "0 3 * * 0" })}
      >
        <PlusIcon />
        Weekly
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd({ type: "cron", expression: "0 */6 * * *" })}
      >
        <PlusIcon />
        Every 6 hours
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd({ type: "cron", expression: "" })}
      >
        <PlusIcon />
        Cron
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd({ type: "startup", delayMs: 60_000 })}
      >
        <PlusIcon />
        Startup
      </Button>
    </div>
  )
}

function ScheduledTaskEditor({
  task,
  draft,
  saving,
  running,
  onDraftChange,
  onRun,
  onSave,
  onReset,
}: {
  task: AdminScheduledTaskInfo
  draft: AdminScheduledTaskTrigger[]
  saving: boolean
  running: boolean
  onDraftChange: (triggers: AdminScheduledTaskTrigger[]) => void
  onRun: () => void
  onSave: () => void
  onReset: () => void
}) {
  const busy = saving || running
  const isDirty = !sameTriggers(draft, task.triggers)

  function setTrigger(index: number, next: AdminScheduledTaskTrigger) {
    onDraftChange(draft.map((trigger, i) => (i === index ? next : trigger)))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <Section>
        <SectionHeader>
          <div className="min-w-0">
            <SectionTitle>{task.name}</SectionTitle>
            <p className="text-foreground-dim mt-1 text-sm">
              {task.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge task={task} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || task.state === "running"}
              onClick={onRun}
            >
              <PlayIcon />
              {running ? "Starting…" : "Run"}
            </Button>
          </div>
        </SectionHeader>

        <fieldset disabled={saving} className="contents">
          <SectionContent className="flex flex-col gap-3">
            <div className="text-foreground-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-foreground-dim">Last run:</span>{" "}
                {formatDateTime(task.lastFinishedAt)}
              </span>
              <span>
                <span className="text-foreground-dim">Duration:</span>{" "}
                {formatDuration(task.lastDurationMs)}
              </span>
            </div>

            <TaskResult result={task.lastResult} />

            <div className="border-border flex flex-col gap-2 border-t pt-3">
              <div className="text-foreground-dim text-xs">Triggers</div>
              {draft.length === 0 ? (
                <p className="text-foreground-dim text-sm">
                  No triggers yet. Add one below to run this task automatically.
                </p>
              ) : (
                draft.map((trigger, index) => (
                  <TriggerRow
                    key={index}
                    id={task.id}
                    index={index}
                    trigger={trigger}
                    disabled={saving}
                    onChange={(next) => setTrigger(index, next)}
                    onRemove={() =>
                      onDraftChange(draft.filter((_, i) => i !== index))
                    }
                  />
                ))
              )}
              <AddTriggerButtons
                disabled={saving}
                onAdd={(trigger) => onDraftChange([...draft, trigger])}
              />
            </div>
          </SectionContent>

          <SectionFooter>
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              <Button
                className="flex-1 sm:flex-initial"
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving || !isDirty}
                onClick={onReset}
              >
                <RotateCcwIcon />
                Reset
              </Button>
              <Button
                className="flex-1 sm:flex-initial"
                type="submit"
                variant="primary"
                size="sm"
                disabled={saving || !isDirty}
              >
                <SaveIcon />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </SectionFooter>
        </fieldset>
      </Section>
    </form>
  )
}

export function ScheduledTasksCard() {
  const queryClient = useQueryClient()
  const tasksQuery = useQuery(adminScheduledTasksQueryOptions())
  const tasks = tasksQuery.data?.tasks ?? null
  const [drafts, setDrafts] = React.useState<Drafts>({})
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const [runningId, setRunningId] = React.useState<string | null>(null)
  const savedTriggersRef = React.useRef<Drafts>({})
  const hasRunningTask =
    tasks?.some((task) => task.state === "running") ?? false

  React.useEffect(() => {
    if (!tasks) return
    setDrafts((current) => {
      const next = { ...current }
      for (const task of tasks) {
        const saved = savedTriggersRef.current[task.id]
        if (
          !current[task.id] ||
          (saved && sameTriggers(current[task.id], saved))
        ) {
          next[task.id] = copyTriggers(task.triggers)
        }
        savedTriggersRef.current[task.id] = copyTriggers(task.triggers)
      }
      return next
    })
  }, [tasks])

  React.useEffect(() => {
    if (!hasRunningTask) return
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: adminKeys.scheduledTasks(),
      })
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [hasRunningTask, queryClient])

  async function runTask(task: AdminScheduledTaskInfo) {
    if (runningId) return
    setRunningId(task.id)
    try {
      const response = await api.admin.runScheduledTask(task.id)
      setScheduledTaskCache(queryClient, response.task)
      toast.success(
        response.started
          ? "Scheduled task started"
          : response.queued
            ? "Scheduled task queued"
            : "Task is already running",
      )
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't start scheduled task"))
    } finally {
      setRunningId(null)
    }
  }

  async function saveTask(task: AdminScheduledTaskInfo) {
    if (savingId) return
    const draft = drafts[task.id] ?? task.triggers
    const triggers = normalizeTriggers(draft)
    if (!triggers || sameTriggers(triggers, task.triggers)) return

    setSavingId(task.id)
    try {
      const updated = await api.admin.updateScheduledTaskTriggers(
        task.id,
        triggers,
      )
      savedTriggersRef.current[task.id] = copyTriggers(updated.triggers)
      setDrafts((current) => ({
        ...current,
        [task.id]: copyTriggers(updated.triggers),
      }))
      setScheduledTaskCache(queryClient, updated)
      toast.success("Scheduled task updated")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update scheduled task"))
    } finally {
      setSavingId(null)
    }
  }

  if (tasksQuery.error) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
        {errorMessage(tasksQuery.error, "Couldn't load scheduled tasks")}
      </div>
    )
  }

  if (!tasks) {
    return (
      <div className="text-foreground-dim flex items-center gap-2 text-sm">
        <Spinner className="size-4" />
        Loading scheduled tasks…
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="text-foreground-dim text-sm">No scheduled tasks.</div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {tasks.map((task) => (
        <ScheduledTaskEditor
          key={task.id}
          task={task}
          draft={drafts[task.id] ?? task.triggers}
          saving={savingId === task.id}
          running={runningId === task.id}
          onDraftChange={(triggers) =>
            setDrafts((current) => ({ ...current, [task.id]: triggers }))
          }
          onRun={() => void runTask(task)}
          onSave={() => void saveTask(task)}
          onReset={() =>
            setDrafts((current) => ({
              ...current,
              [task.id]: copyTriggers(task.triggers),
            }))
          }
        />
      ))}
    </div>
  )
}
