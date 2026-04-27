import * as React from "react"
import {
  Section,
  SectionContent,
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

export type StorageDriverKind = (typeof STORAGE_DRIVERS)[number]

import { api } from "@/lib/api"
import { clampInt } from "./shared"
import {
  DriverPicker,
  FsFields,
  S3Fields,
  StorageActions,
} from "./storage-config-fields"

const REDACTED = INTEGRATIONS_REDACTED // "***"

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

export interface FsForm {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

export interface S3Form {
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
