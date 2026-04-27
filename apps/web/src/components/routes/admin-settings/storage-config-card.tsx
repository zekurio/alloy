import * as React from "react"
import { AlertCircleIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { toast } from "@workspace/ui/lib/toast"

import {
  INTEGRATIONS_REDACTED,
  STORAGE_DRIVERS,
  type AdminFsStorageConfig,
  type AdminRuntimeConfig,
  type AdminS3StorageConfig,
  type AdminStorageConfig,
  type AdminStorageConfigPatch,
} from "@workspace/api"

type StorageDriverKind = (typeof STORAGE_DRIVERS)[number]

import { api } from "@/lib/api"
import { clampInt } from "./shared"

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const REDACTED = INTEGRATIONS_REDACTED // "***"

const DRIVER_LABELS: Record<StorageDriverKind, string> = {
  fs: "Local filesystem",
  s3: "S3-compatible",
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StorageConfigCardProps = {
  storage: AdminStorageConfig
  onChange: (next: AdminRuntimeConfig) => void
  allowSubmitUnchanged?: boolean
  submitLabel?: string
  /** Called after a successful save (or when submitted with no changes). */
  onSaved?: () => void
  /** Hide the footer action buttons (Cancel / Save). */
  hideActions?: boolean
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
  /** HTML `id` for the `<form>` element, useful for external submit buttons. */
  formId?: string
}

interface FsForm {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

interface S3Form {
  bucket: string
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  presignExpiresSec: string // kept as string for the input
}

interface StorageForm {
  driver: StorageDriverKind
  fs: FsForm
  s3: S3Form
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function blankRedacted(value: string): string {
  return value === REDACTED ? "" : value
}

function toFsForm(fs: AdminFsStorageConfig): FsForm {
  return {
    root: fs.root,
    publicBaseUrl: fs.publicBaseUrl,
    hmacSecret: blankRedacted(fs.hmacSecret),
  }
}

function toS3Form(s3: AdminS3StorageConfig): S3Form {
  return {
    bucket: s3.bucket,
    region: s3.region,
    endpoint: s3.endpoint ?? "",
    accessKeyId: s3.accessKeyId ?? "",
    secretAccessKey: blankRedacted(s3.secretAccessKey ?? ""),
    forcePathStyle: s3.forcePathStyle,
    presignExpiresSec: String(s3.presignExpiresSec),
  }
}

function toForm(storage: AdminStorageConfig): StorageForm {
  return {
    driver: storage.driver,
    fs: toFsForm(storage.fs),
    s3: toS3Form(storage.s3),
  }
}

function buildPatch(
  form: StorageForm,
  initial: StorageForm
): AdminStorageConfigPatch | null {
  if (form.driver === "fs") {
    if (form.fs.root.trim().length === 0) {
      toast.error("Filesystem root path is required.")
      return null
    }
    if (form.fs.publicBaseUrl.trim().length === 0) {
      toast.error("Public base URL is required.")
      return null
    }
  }

  if (form.driver === "s3") {
    if (form.s3.bucket.trim().length === 0) {
      toast.error("S3 bucket is required.")
      return null
    }
    if (form.s3.region.trim().length === 0) {
      toast.error("S3 region is required.")
      return null
    }
  }

  const presignSec = clampInt(form.s3.presignExpiresSec, 60, 86_400, 3600)

  const patch: AdminStorageConfigPatch = { driver: form.driver }

  // Build FS patch — omit hmacSecret if untouched so the server keeps the
  // existing value.
  const fsPatch: AdminStorageConfigPatch["fs"] = {
    root: form.fs.root.trim(),
    publicBaseUrl: form.fs.publicBaseUrl.trim(),
  }
  if (
    form.fs.hmacSecret !== initial.fs.hmacSecret &&
    form.fs.hmacSecret !== ""
  ) {
    fsPatch.hmacSecret = form.fs.hmacSecret
  }
  patch.fs = fsPatch

  const s3Patch: AdminStorageConfigPatch["s3"] = {
    bucket: form.s3.bucket.trim(),
    region: form.s3.region.trim(),
    endpoint:
      form.s3.endpoint.trim().length > 0 ? form.s3.endpoint.trim() : null,
    accessKeyId:
      form.s3.accessKeyId.trim().length > 0 ? form.s3.accessKeyId.trim() : null,
    forcePathStyle: form.s3.forcePathStyle,
    presignExpiresSec: presignSec,
  }
  if (
    form.s3.secretAccessKey !== initial.s3.secretAccessKey &&
    form.s3.secretAccessKey !== ""
  ) {
    s3Patch.secretAccessKey = form.s3.secretAccessKey
  }
  patch.s3 = s3Patch

  return patch
}

function formEquals(a: StorageForm, b: StorageForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

function useStorageConfigForm({
  storage,
  onChange,
  onSaved,
}: StorageConfigCardProps) {
  const initial = React.useMemo(() => toForm(storage), [storage])
  const [form, setForm] = React.useState<StorageForm>(initial)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    setForm(initial)
  }, [initial])

  const isDirty = !formEquals(form, initial)

  function setDriver(driver: StorageDriverKind) {
    setForm((f) => ({ ...f, driver }))
  }

  function setFs<K extends keyof FsForm>(key: K, value: FsForm[K]) {
    setForm((f) => ({ ...f, fs: { ...f.fs, [key]: value } }))
  }

  function setS3<K extends keyof S3Form>(key: K, value: S3Form[K]) {
    setForm((f) => ({ ...f, s3: { ...f.s3, [key]: value } }))
  }

  function resetForm() {
    setForm(initial)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!isDirty) {
      onSaved?.()
      return
    }
    const patch = buildPatch(form, initial)
    if (!patch) return
    setPending(true)
    try {
      const next = await api.admin.updateStorageConfig(patch)
      onChange(next)
      onSaved?.()
      toast.success("Storage updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update storage"
      )
    } finally {
      setPending(false)
    }
  }

  async function onClearS3Secret() {
    if (pending) return
    setPending(true)
    try {
      const next = await api.admin.updateStorageConfig({
        s3: { secretAccessKey: null },
      })
      onChange(next)
      toast.success("S3 secret access key removed")
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Couldn't remove S3 secret access key"
      )
    } finally {
      setPending(false)
    }
  }

  return {
    form,
    pending,
    isDirty,
    setDriver,
    setFs,
    setS3,
    resetForm,
    onSubmit,
    onClearS3Secret,
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function DriverPicker({
  driver,
  onChange,
}: {
  driver: StorageDriverKind
  onChange: (next: StorageDriverKind) => void
}) {
  return (
    <Field>
      <FieldLabel>Storage driver</FieldLabel>
      <RadioGroup
        value={driver}
        onValueChange={(val) => onChange(val as StorageDriverKind)}
        className="flex gap-4"
      >
        {STORAGE_DRIVERS.map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={d} />
            {DRIVER_LABELS[d]}
          </label>
        ))}
      </RadioGroup>
    </Field>
  )
}

function FsFields({
  form,
  hmacConfigured,
  onChange,
}: {
  form: FsForm
  hmacConfigured: boolean
  onChange: <K extends keyof FsForm>(key: K, value: FsForm[K]) => void
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="storage-fs-root" required>
            Root path
          </FieldLabel>
          <Input
            id="storage-fs-root"
            value={form.root}
            required
            onChange={(e) => onChange("root", e.target.value)}
          />
          <FieldDescription>
            Absolute or relative path where clips are stored.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="storage-fs-base-url" required>
            Public base URL
          </FieldLabel>
          <Input
            id="storage-fs-base-url"
            type="url"
            value={form.publicBaseUrl}
            required
            onChange={(e) => onChange("publicBaseUrl", e.target.value)}
          />
          <FieldDescription>
            URL prefix used in playback links.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="storage-fs-hmac">HMAC secret</FieldLabel>
        <Input
          id="storage-fs-hmac"
          type="password"
          autoComplete="new-password"
          value={form.hmacSecret}
          placeholder={hmacConfigured ? "Leave blank to keep current" : ""}
          onChange={(e) => onChange("hmacSecret", e.target.value)}
        />
        <FieldDescription>
          {hmacConfigured
            ? "Configured. Type a new value to rotate."
            : "Used to sign storage URLs. Min 32 characters."}
        </FieldDescription>
      </Field>
    </>
  )
}

function S3Fields({
  form,
  secretConfigured,
  pending,
  isDirty,
  onChange,
  onClearSecret,
}: {
  form: S3Form
  secretConfigured: boolean
  pending: boolean
  isDirty: boolean
  onChange: <K extends keyof S3Form>(key: K, value: S3Form[K]) => void
  onClearSecret: () => void
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="storage-s3-bucket" required>
            Bucket
          </FieldLabel>
          <Input
            id="storage-s3-bucket"
            value={form.bucket}
            required
            onChange={(e) => onChange("bucket", e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="storage-s3-region" required>
            Region
          </FieldLabel>
          <Input
            id="storage-s3-region"
            value={form.region}
            required
            onChange={(e) => onChange("region", e.target.value)}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="storage-s3-endpoint">Endpoint</FieldLabel>
        <Input
          id="storage-s3-endpoint"
          type="url"
          value={form.endpoint}
          placeholder="https://s3.amazonaws.com"
          onChange={(e) => onChange("endpoint", e.target.value)}
        />
        <FieldDescription>
          Custom endpoint for S3-compatible providers (MinIO, R2, etc.).
        </FieldDescription>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="storage-s3-access-key">Access key ID</FieldLabel>
          <Input
            id="storage-s3-access-key"
            value={form.accessKeyId}
            autoComplete="off"
            onChange={(e) => onChange("accessKeyId", e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="storage-s3-secret-key">
            Secret access key
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="storage-s3-secret-key"
              type="password"
              className="pl-3.5"
              autoComplete="new-password"
              value={form.secretAccessKey}
              placeholder={
                secretConfigured ? "Leave blank to keep current" : ""
              }
              onChange={(e) => onChange("secretAccessKey", e.target.value)}
            />
            {secretConfigured ? (
              <InputGroupAddon align="inline-end">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-danger hover:text-danger"
                        aria-label="Remove S3 secret access key"
                        title="Remove secret access key"
                        disabled={pending || isDirty}
                      />
                    }
                  >
                    <Trash2Icon />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Remove S3 secret access key?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the stored static credential. S3 access
                        will use instance-role or workload identity credentials
                        until a new secret is added.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={pending}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={onClearSecret}
                        disabled={pending}
                      >
                        {pending ? "Removing..." : "Remove secret"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <FieldDescription>
            {secretConfigured
              ? "Configured. Type a new value to rotate."
              : "Leave blank to use instance-role credentials."}
          </FieldDescription>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="storage-s3-presign">
            Pre-sign expiry (seconds)
          </FieldLabel>
          <Input
            id="storage-s3-presign"
            type="number"
            min={60}
            max={86_400}
            step={60}
            value={form.presignExpiresSec}
            onChange={(e) => onChange("presignExpiresSec", e.target.value)}
          />
          <FieldDescription>
            How long pre-signed upload/download URLs stay valid.
          </FieldDescription>
        </Field>

        <Field>
          <div className="flex h-9 items-center gap-2 pt-6">
            <Checkbox
              checked={form.forcePathStyle}
              onCheckedChange={(checked) =>
                onChange("forcePathStyle", checked === true)
              }
            />
            <FieldLabel htmlFor="storage-s3-path-style" className="mb-0">
              Force path-style
            </FieldLabel>
          </div>
          <FieldDescription>
            Required for some S3-compatible providers (e.g. MinIO).
          </FieldDescription>
        </Field>
      </div>
    </>
  )
}

function StorageActions({
  allowSubmitUnchanged,
  pending,
  isDirty,
  onReset,
  submitLabel = "Save storage",
}: {
  allowSubmitUnchanged?: boolean
  pending: boolean
  isDirty: boolean
  onReset: () => void
  submitLabel?: string
}) {
  return (
    <SectionFooter>
      <div className="flex items-center gap-1.5 text-xs text-foreground-dim">
        <AlertCircleIcon className="size-3.5 shrink-0" />
        <span>Storage changes apply immediately to new requests.</span>
      </div>
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
          disabled={pending || (!isDirty && !allowSubmitUnchanged)}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </SectionFooter>
  )
}

/* ------------------------------------------------------------------ */
/*  Main card                                                          */
/* ------------------------------------------------------------------ */

export function StorageConfigCard(props: StorageConfigCardProps) {
  const state = useStorageConfigForm(props)

  const hmacConfigured = props.storage.fs.hmacSecret === REDACTED
  const secretConfigured = (props.storage.s3.secretAccessKey ?? "") === REDACTED

  return (
    <form id={props.formId} onSubmit={state.onSubmit}>
      <Section>
        {!props.hideHeader && (
          <SectionHeader>
            <SectionTitle>Storage</SectionTitle>
          </SectionHeader>
        )}
        <fieldset disabled={state.pending} className="contents">
          <SectionContent className="flex flex-col gap-4">
            <DriverPicker
              driver={state.form.driver}
              onChange={state.setDriver}
            />

            {state.form.driver === "fs" ? (
              <FsFields
                form={state.form.fs}
                hmacConfigured={hmacConfigured}
                onChange={state.setFs}
              />
            ) : (
              <S3Fields
                form={state.form.s3}
                secretConfigured={secretConfigured}
                pending={state.pending}
                isDirty={state.isDirty}
                onChange={state.setS3}
                onClearSecret={state.onClearS3Secret}
              />
            )}
          </SectionContent>

          {!props.hideActions && (
            <StorageActions
              allowSubmitUnchanged={props.allowSubmitUnchanged}
              pending={state.pending}
              isDirty={state.isDirty}
              onReset={state.resetForm}
              submitLabel={props.submitLabel}
            />
          )}
        </fieldset>
      </Section>
    </form>
  )
}
