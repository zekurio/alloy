import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminScheduledTaskInfo,
  AdminScheduledTaskResult,
  AdminScheduledTaskTrigger,
  AdminScheduledTasksResponse,
} from "alloy-api"
import { Button } from "alloy-ui/components/button"
import { List, ListItem } from "alloy-ui/components/list"
import { Spinner } from "alloy-ui/components/spinner"
import { toast } from "alloy-ui/lib/toast"
import { PlayIcon } from "lucide-react"
import * as React from "react"

import {
  adminKeys,
  adminScheduledTasksQueryOptions,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { ScheduleDialog } from "./scheduled-task-schedule-dialog"
import {
  copyTriggers,
  normalizeTriggers,
  sameTriggers,
  summarizeTriggers,
} from "./scheduled-task-triggers"

type Drafts = Record<string, AdminScheduledTaskTrigger[]>

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
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium ${tone}`}
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
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(([key, value]) => (
        <span key={key}>
          <span className="text-foreground-dim">{humanizeResultKey(key)}:</span>{" "}
          {String(value)}
        </span>
      ))}
    </>
  )
}

function ScheduledTaskRow({
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
  onSave: () => Promise<boolean>
  onReset: () => void
}) {
  const busy = saving || running

  return (
    <ListItem className="items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{task.name}</span>
          <StatusBadge task={task} />
        </div>
        <p className="text-foreground-dim mt-0.5 text-xs">{task.description}</p>
        <div className="text-foreground-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span>
            <span className="text-foreground-dim">Last run:</span>{" "}
            {formatDateTime(task.lastFinishedAt)}
          </span>
          {task.lastDurationMs !== null ? (
            <span>
              <span className="text-foreground-dim">Duration:</span>{" "}
              {formatDuration(task.lastDurationMs)}
            </span>
          ) : null}
          <TaskResult result={task.lastResult} />
          <span>
            <span className="text-foreground-dim">Schedule:</span>{" "}
            {summarizeTriggers(task.triggers)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
        <ScheduleDialog
          task={task}
          draft={draft}
          saving={saving}
          onDraftChange={onDraftChange}
          onReset={onReset}
          onSave={onSave}
        />
      </div>
    </ListItem>
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

  async function saveTask(task: AdminScheduledTaskInfo): Promise<boolean> {
    if (savingId) return false
    const draft = drafts[task.id] ?? task.triggers
    const triggers = normalizeTriggers(draft)
    if (!triggers) return false
    if (sameTriggers(triggers, task.triggers)) return true

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
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update scheduled task"))
      return false
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
    <List>
      {tasks.map((task) => (
        <ScheduledTaskRow
          key={task.id}
          task={task}
          draft={drafts[task.id] ?? task.triggers}
          saving={savingId === task.id}
          running={runningId === task.id}
          onDraftChange={(triggers) =>
            setDrafts((current) => ({ ...current, [task.id]: triggers }))
          }
          onRun={() => void runTask(task)}
          onSave={() => saveTask(task)}
          onReset={() =>
            setDrafts((current) => ({
              ...current,
              [task.id]: copyTriggers(task.triggers),
            }))
          }
        />
      ))}
    </List>
  )
}
