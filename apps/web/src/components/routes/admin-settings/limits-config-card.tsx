import * as React from "react"
import { AlertCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import type { AdminLimitsConfig, AdminRuntimeConfig } from "@workspace/api"

import { api } from "@/lib/api"
import { clampInt } from "./shared"

type LimitsConfigCardProps = {
  limits: AdminLimitsConfig
  onChange: (next: AdminRuntimeConfig) => void
}

function formatMaxUploadMiB(maxUploadBytes: number) {
  return String(Math.round(maxUploadBytes / (1024 * 1024)))
}

function LimitsFields({
  form,
  maxUploadMiB,
  onFieldChange,
  onMaxUploadChange,
}: {
  form: AdminLimitsConfig
  maxUploadMiB: string
  onFieldChange: <K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K]
  ) => void
  onMaxUploadChange: (value: string) => void
}) {
  return (
    <CardContent className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="limits-max-upload" required>
            Max upload size (MiB)
          </FieldLabel>
          <Input
            id="limits-max-upload"
            type="number"
            min={1}
            max={64 * 1024}
            step={1}
            required
            value={maxUploadMiB}
            onChange={(e) => onMaxUploadChange(e.target.value)}
          />
          <FieldDescription>
            Per-file upload cap. Server hard-limits at 64 GiB.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="limits-ttl" required>
            Upload ticket TTL (seconds)
          </FieldLabel>
          <Input
            id="limits-ttl"
            type="number"
            min={60}
            max={86_400}
            step={30}
            required
            value={form.uploadTtlSec}
            onChange={(e) =>
              onFieldChange(
                "uploadTtlSec",
                clampInt(e.target.value, 60, 86_400, form.uploadTtlSec)
              )
            }
          />
          <FieldDescription>
            Upload URL lifetime. 15 min suits slow connections.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="limits-concurrency" required>
          Queue concurrency
        </FieldLabel>
        <Input
          id="limits-concurrency"
          type="number"
          min={1}
          max={16}
          step={1}
          required
          value={form.queueConcurrency}
          onChange={(e) =>
            onFieldChange(
              "queueConcurrency",
              clampInt(e.target.value, 1, 16, form.queueConcurrency)
            )
          }
        />
        <FieldDescription className="flex items-start gap-1.5">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>Parallel encode jobs. Requires a server restart to apply.</span>
        </FieldDescription>
      </Field>
    </CardContent>
  )
}

function LimitsActions({
  pending,
  isDirty,
  onReset,
}: {
  pending: boolean
  isDirty: boolean
  onReset: () => void
}) {
  return (
    <CardFooter>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={pending || !isDirty}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || !isDirty}
        >
          {pending ? "Saving…" : "Save limits"}
        </Button>
      </div>
    </CardFooter>
  )
}

export function LimitsConfigCard({ limits, onChange }: LimitsConfigCardProps) {
  const [form, setForm] = React.useState<AdminLimitsConfig>(limits)
  const [pending, setPending] = React.useState(false)
  const [maxUploadMiB, setMaxUploadMiB] = React.useState<string>(() =>
    formatMaxUploadMiB(limits.maxUploadBytes)
  )
  const initialMaxUploadMiB = React.useMemo(
    () => formatMaxUploadMiB(limits.maxUploadBytes),
    [limits.maxUploadBytes]
  )

  React.useEffect(() => {
    setForm(limits)
    setMaxUploadMiB(initialMaxUploadMiB)
  }, [initialMaxUploadMiB, limits])

  function set<K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setForm(limits)
    setMaxUploadMiB(initialMaxUploadMiB)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    const parsedMiB = Number(maxUploadMiB)
    if (!Number.isFinite(parsedMiB) || parsedMiB <= 0) {
      toast.error("Max upload size must be a positive number of MiB.")
      return
    }
    setPending(true)
    try {
      const next = await api.admin.updateLimitsConfig({
        ...form,
        maxUploadBytes: Math.round(parsedMiB * 1024 * 1024),
      })
      onChange(next)
      toast.success("Limits updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update limits"
      )
    } finally {
      setPending(false)
    }
  }

  const isDirty =
    form.uploadTtlSec !== limits.uploadTtlSec ||
    form.queueConcurrency !== limits.queueConcurrency ||
    maxUploadMiB !== initialMaxUploadMiB

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
        </CardHeader>
        <fieldset disabled={pending} className="contents">
          <LimitsFields
            form={form}
            maxUploadMiB={maxUploadMiB}
            onFieldChange={set}
            onMaxUploadChange={setMaxUploadMiB}
          />
          <LimitsActions pending={pending} isDirty={isDirty} onReset={resetForm} />
        </fieldset>
      </Card>
    </form>
  )
}
