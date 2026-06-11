import type {
  AdminScheduledTaskInfo,
  AdminScheduledTaskTrigger,
} from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@alloy/ui/components/dialog"
import { Input } from "@alloy/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import {
  CalendarClockIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { NumberInput } from "@/components/routes/admin-settings/number-input"

import {
  CRON_PRESETS,
  type CronPresetId,
  CUSTOM_PRESET,
  expressionForPreset,
  presetIdForExpression,
  sameTriggers,
  STARTUP_DELAY_MAX_SECONDS,
} from "./scheduled-task-triggers"

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

export function ScheduleDialog({
  task,
  draft,
  saving,
  onDraftChange,
  onReset,
  onSave,
}: {
  task: AdminScheduledTaskInfo
  draft: AdminScheduledTaskTrigger[]
  saving: boolean
  onDraftChange: (triggers: AdminScheduledTaskTrigger[]) => void
  onReset: () => void
  onSave: () => Promise<boolean>
}) {
  const [open, setOpen] = React.useState(false)
  const isDirty = !sameTriggers(draft, task.triggers)

  function handleOpenChange(next: boolean) {
    // Start each editing session from the saved schedule so abandoned edits
    // don't linger the next time the dialog is opened.
    if (next) onReset()
    setOpen(next)
  }

  function setTrigger(index: number, next: AdminScheduledTaskTrigger) {
    onDraftChange(draft.map((trigger, i) => (i === index ? next : trigger)))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (await onSave()) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <CalendarClockIcon />
            Schedule
          </Button>
        }
      />
      <DialogContent variant="secondary" className="max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{task.name}</DialogTitle>
            <DialogDescription>
              Choose when this task runs automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {draft.length === 0 ? (
              <p className="text-foreground-dim text-sm">
                No triggers yet. Add one below to run this task automatically.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.map((trigger, index) => (
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
                ))}
              </div>
            )}
            <AddTriggerButtons
              disabled={saving}
              onAdd={(trigger) => onDraftChange([...draft, trigger])}
            />
          </DialogBody>
          <DialogFooter>
            <Button
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
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving || !isDirty}
            >
              <SaveIcon />
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
