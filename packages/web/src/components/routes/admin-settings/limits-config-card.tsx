import type { AdminLimitsConfig, AdminRuntimeConfig } from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { toast } from "@alloy/ui/lib/toast"
import { SaveIcon } from "lucide-react"
import * as React from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { formatQuotaGiB, parseQuotaGiB } from "@/lib/storage-format"

import { FormGroup } from "./form-group"
import { NumberInput } from "./number-input"

type LimitsConfigCardProps = {
  limits: AdminLimitsConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

function LimitsFields({
  form,
  storageQuotaGiB,
  onFieldChange,
  onStorageQuotaChange,
}: {
  form: AdminLimitsConfig
  storageQuotaGiB: string
  onFieldChange: <K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K],
  ) => void
  onStorageQuotaChange: (value: string) => void
}) {
  return (
    <SectionContent className="flex flex-col gap-0">
      <FormGroup title="Uploads" description="URL lifetime constraints.">
        <Field>
          <FieldLabel htmlFor="limits-ttl" required>
            Upload ticket TTL (seconds)
          </FieldLabel>
          <NumberInput
            id="limits-ttl"
            min={60}
            max={86_400}
            step={30}
            required
            value={form.uploadTtlSec}
            onChange={(value) => onFieldChange("uploadTtlSec", value)}
          />
        </Field>
      </FormGroup>

      <FormGroup
        title="Storage"
        description="Default quota applied to new user accounts."
      >
        <Field>
          <FieldLabel htmlFor="limits-default-storage-quota">
            Default storage quota (GiB)
          </FieldLabel>
          <Input
            id="limits-default-storage-quota"
            type="number"
            min={1}
            step={1}
            value={storageQuotaGiB}
            placeholder="Unlimited"
            onChange={(e) => onStorageQuotaChange(e.target.value)}
          />
        </Field>
      </FormGroup>
    </SectionContent>
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
    <SectionFooter>
      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        <Button
          className="flex-1 sm:flex-initial"
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={pending || !isDirty}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 sm:flex-initial"
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || !isDirty}
        >
          <SaveIcon />
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SectionFooter>
  )
}

function parseLimitsPatch({
  form,
  storageQuotaGiB,
}: {
  form: AdminLimitsConfig
  storageQuotaGiB: string
}): Partial<AdminLimitsConfig> | null {
  let defaultStorageQuotaBytes: number | null
  try {
    defaultStorageQuotaBytes = parseQuotaGiB(storageQuotaGiB)
  } catch (cause) {
    toast.error(errorMessage(cause, "Invalid limit."))
    return null
  }

  return {
    ...form,
    defaultStorageQuotaBytes,
  }
}

function parseLimitsPatchQuiet({
  form,
  storageQuotaGiB,
}: {
  form: AdminLimitsConfig
  storageQuotaGiB: string
}): Partial<AdminLimitsConfig> | null {
  try {
    return {
      ...form,
      defaultStorageQuotaBytes: parseQuotaGiB(storageQuotaGiB),
    }
  } catch {
    return null
  }
}

function limitsConfigEquals(
  current: Partial<AdminLimitsConfig> | null,
  saved: AdminLimitsConfig,
): boolean {
  if (!current) return false
  return (
    current.defaultStorageQuotaBytes === saved.defaultStorageQuotaBytes &&
    current.uploadTtlSec === saved.uploadTtlSec
  )
}

function useLimitsConfigForm({ limits, onChange }: LimitsConfigCardProps) {
  const [form, setForm] = React.useState<AdminLimitsConfig>(limits)
  const [pending, setPending] = React.useState(false)
  const [storageQuotaGiB, setStorageQuotaGiB] = React.useState<string>(() =>
    formatQuotaGiB(limits.defaultStorageQuotaBytes),
  )
  const initialStorageQuotaGiB = React.useMemo(
    () => formatQuotaGiB(limits.defaultStorageQuotaBytes),
    [limits.defaultStorageQuotaBytes],
  )

  React.useEffect(() => {
    setForm(limits)
    setStorageQuotaGiB(initialStorageQuotaGiB)
  }, [initialStorageQuotaGiB, limits])

  function set<K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setForm(limits)
    setStorageQuotaGiB(initialStorageQuotaGiB)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    const patch = parseLimitsPatch({ form, storageQuotaGiB })
    if (!patch) return
    if (limitsConfigEquals(patch, limits)) return
    setPending(true)
    try {
      const next = await api.admin.updateLimitsConfig(patch)
      onChange(next)
      toast.success("Limits updated")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update limits"))
    } finally {
      setPending(false)
    }
  }

  const comparablePatch = parseLimitsPatchQuiet({
    form,
    storageQuotaGiB,
  })
  const isDirty = !limitsConfigEquals(comparablePatch, limits)

  return {
    form,
    pending,
    storageQuotaGiB,
    isDirty,
    set,
    setStorageQuotaGiB,
    resetForm,
    onSubmit,
  }
}

export function LimitsConfigCard(props: LimitsConfigCardProps) {
  const state = useLimitsConfigForm(props)

  return (
    <form onSubmit={state.onSubmit}>
      <Section>
        {!props.hideHeader && (
          <SectionHeader>
            <SectionTitle>Limits</SectionTitle>
          </SectionHeader>
        )}
        <fieldset disabled={state.pending} className="contents">
          <LimitsFields
            form={state.form}
            storageQuotaGiB={state.storageQuotaGiB}
            onFieldChange={state.set}
            onStorageQuotaChange={state.setStorageQuotaGiB}
          />
          <LimitsActions
            pending={state.pending}
            isDirty={state.isDirty}
            onReset={state.resetForm}
          />
        </fieldset>
      </Section>
    </form>
  )
}
