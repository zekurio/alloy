import * as React from "react"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { toast } from "@workspace/ui/lib/toast"

import {
  type AdminFsStorageConfig,
  type AdminRuntimeConfig,
  type AdminS3StorageConfig,
  type AdminStorageConfig,
  type AdminStorageConfigPatch,
  INTEGRATIONS_REDACTED,
} from "@workspace/api"
import type { StorageDriverKind } from "@workspace/contracts"

export type { StorageDriverKind } from "@workspace/contracts"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import {
  clampInt,
  emptyToNull,
  requiredTrimmedString,
  trimString,
} from "./shared"
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

interface ComparableStorageForm {
  driver: StorageDriverKind
  fs: {
    root: string
    publicBaseUrl: string
    hmacSecret: string
  }
  s3: {
    bucket: string
    region: string
    endpoint: string | null
    accessKeyId: string | null
    secretAccessKey: string | null
    forcePathStyle: boolean
    presignExpiresSec: number
  }
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
  initial: StorageForm,
  s3SecretConfigured: boolean,
): AdminStorageConfigPatch | null {
  const fsRoot = requiredTrimmedString(form.fs.root)
  const fsPublicBaseUrl = requiredTrimmedString(form.fs.publicBaseUrl)
  const s3Bucket = requiredTrimmedString(form.s3.bucket)
  const s3Region = requiredTrimmedString(form.s3.region)

  if (form.driver === "fs") {
    if (!fsRoot) {
      toast.error("Filesystem root path is required.")
      return null
    }
    if (!fsPublicBaseUrl) {
      toast.error("Public base URL is required.")
      return null
    }
  }

  if (form.driver === "s3") {
    if (!s3Bucket) {
      toast.error("S3 bucket is required.")
      return null
    }
    if (!s3Region) {
      toast.error("S3 region is required.")
      return null
    }
  }

  const presignSec = clampInt(form.s3.presignExpiresSec, 60, 86_400, 3600)
  const s3AccessKeyId = requiredTrimmedString(form.s3.accessKeyId)
  const s3SecretAccessKey = requiredTrimmedString(form.s3.secretAccessKey)

  if (form.driver === "s3") {
    if (!s3AccessKeyId && s3SecretAccessKey) {
      toast.error("S3 access key ID is required when a secret is provided.")
      return null
    }
    if (s3AccessKeyId && !s3SecretAccessKey && !s3SecretConfigured) {
      toast.error(
        "S3 secret access key is required when an access key ID is provided.",
      )
      return null
    }
  }

  const patch: AdminStorageConfigPatch = { driver: form.driver }

  // Build FS patch — omit hmacSecret if untouched so the server keeps the
  // existing value.
  const fsPatch: AdminStorageConfigPatch["fs"] = {
    root: fsRoot ?? trimString(form.fs.root),
    publicBaseUrl: fsPublicBaseUrl ?? trimString(form.fs.publicBaseUrl),
  }
  if (
    form.fs.hmacSecret !== initial.fs.hmacSecret &&
    form.fs.hmacSecret !== ""
  ) {
    fsPatch.hmacSecret = form.fs.hmacSecret
  }
  patch.fs = fsPatch

  const s3Patch: AdminStorageConfigPatch["s3"] = {
    bucket: s3Bucket ?? trimString(form.s3.bucket),
    region: s3Region ?? trimString(form.s3.region),
    endpoint: emptyToNull(form.s3.endpoint),
    accessKeyId: s3AccessKeyId,
    forcePathStyle: form.s3.forcePathStyle,
    presignExpiresSec: presignSec,
  }
  if (!s3AccessKeyId) {
    s3Patch.secretAccessKey = null
  } else if (
    form.s3.secretAccessKey !== initial.s3.secretAccessKey &&
    s3SecretAccessKey
  ) {
    s3Patch.secretAccessKey = s3SecretAccessKey
  }
  patch.s3 = s3Patch

  return patch
}

function comparableStorageForm(form: StorageForm): ComparableStorageForm {
  return {
    driver: form.driver,
    fs: {
      root: trimString(form.fs.root),
      publicBaseUrl: trimString(form.fs.publicBaseUrl),
      hmacSecret: form.fs.hmacSecret,
    },
    s3: {
      bucket: trimString(form.s3.bucket),
      region: trimString(form.s3.region),
      endpoint: emptyToNull(form.s3.endpoint),
      accessKeyId: requiredTrimmedString(form.s3.accessKeyId),
      secretAccessKey: requiredTrimmedString(form.s3.secretAccessKey),
      forcePathStyle: form.s3.forcePathStyle,
      presignExpiresSec: clampInt(form.s3.presignExpiresSec, 60, 86_400, 3600),
    },
  }
}

function formEquals(a: StorageForm, b: StorageForm): boolean {
  return (
    JSON.stringify(comparableStorageForm(a)) ===
      JSON.stringify(comparableStorageForm(b))
  )
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
  const s3SecretConfigured = (storage.s3.secretAccessKey ?? "") === REDACTED

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
    const patch = buildPatch(form, initial, s3SecretConfigured)
    if (!patch) return
    setPending(true)
    try {
      const next = await api.admin.updateStorageConfig(patch)
      onChange(next)
      onSaved?.()
      toast.success("Storage updated")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update storage"))
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
      toast.error(errorMessage(cause, "Couldn't remove S3 secret access key"))
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

            {state.form.driver === "fs"
              ? (
                <FsFields
                  form={state.form.fs}
                  hmacConfigured={hmacConfigured}
                  onChange={state.setFs}
                />
              )
              : (
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
            />
          )}
        </fieldset>
      </Section>
    </form>
  )
}
