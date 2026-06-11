import type { AdminRuntimeConfig, AdminStorageConfig } from "@alloy/api"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { SaveIcon } from "lucide-react"
import * as React from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { FormGroup } from "./form-group"

type StorageForm = {
  driver: AdminStorageConfig["driver"]
  path: string
  clipsPath: string
  usersPath: string
  s3: AdminStorageConfig["s3"]
  s3AccessKeyId: string
  s3SecretAccessKey: string
}

type StorageConfigCardProps = {
  storage: AdminStorageConfig
  onChange: (next: AdminRuntimeConfig) => void
  onSaved?: () => void
  formId?: string
  hideHeader?: boolean
  hideActions?: boolean
  toastOnSuccess?: boolean
}

function formFromStorage(storage: AdminStorageConfig): StorageForm {
  return {
    driver: storage.driver,
    path: storage.path,
    clipsPath: storage.clipsPath ?? "",
    usersPath: storage.usersPath ?? "",
    s3: { ...storage.s3 },
    s3AccessKeyId: "",
    s3SecretAccessKey: "",
  }
}

function normalizeOptionalPath(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isDirty(form: StorageForm, storage: AdminStorageConfig): boolean {
  return (
    form.driver !== storage.driver ||
    form.path.trim() !== storage.path ||
    normalizeOptionalPath(form.clipsPath) !== storage.clipsPath ||
    normalizeOptionalPath(form.usersPath) !== storage.usersPath ||
    form.s3.bucket.trim() !== storage.s3.bucket ||
    form.s3.region.trim() !== storage.s3.region ||
    normalizeOptionalPath(form.s3.endpoint ?? "") !== storage.s3.endpoint ||
    form.s3.forcePathStyle !== storage.s3.forcePathStyle ||
    form.s3AccessKeyId.trim().length > 0 ||
    form.s3SecretAccessKey.trim().length > 0
  )
}

function validateForm(
  form: StorageForm,
  storage: AdminStorageConfig,
): string | null {
  if (!form.path.trim()) return "Storage path is required"
  if (form.driver !== "s3") return null
  if (!form.s3.bucket.trim()) return "S3 bucket is required"
  if (!form.s3.region.trim()) return "S3 region is required"
  if (form.s3.endpoint) {
    try {
      new URL(form.s3.endpoint)
    } catch {
      return "S3 endpoint must be a valid URL"
    }
  }
  if (!storage.s3AccessKeyIdSet && !form.s3AccessKeyId.trim()) {
    return "S3 access key ID is required"
  }
  if (!storage.s3SecretAccessKeySet && !form.s3SecretAccessKey.trim()) {
    return "S3 secret access key is required"
  }
  return null
}

export function StorageConfigCard({
  storage,
  onChange,
  onSaved,
  formId,
  hideHeader,
  hideActions,
  toastOnSuccess = true,
}: StorageConfigCardProps) {
  const [form, setForm] = React.useState<StorageForm>(() =>
    formFromStorage(storage),
  )
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    setForm(formFromStorage(storage))
  }, [storage])

  function set<K extends keyof StorageForm>(key: K, value: StorageForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setS3<K extends keyof AdminStorageConfig["s3"]>(
    key: K,
    value: AdminStorageConfig["s3"][K],
  ) {
    setForm((current) => ({
      ...current,
      s3: { ...current.s3, [key]: value },
    }))
  }

  function resetForm() {
    setForm(formFromStorage(storage))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    const invalid = validateForm(form, storage)
    if (invalid) {
      toast.error(invalid)
      return
    }

    setPending(true)
    try {
      const updated = await api.admin.updateStorageConfig({
        driver: form.driver,
        path: form.path.trim(),
        clipsPath: normalizeOptionalPath(form.clipsPath),
        usersPath: normalizeOptionalPath(form.usersPath),
        s3: {
          bucket: form.s3.bucket.trim(),
          region: form.s3.region.trim(),
          endpoint: normalizeOptionalPath(form.s3.endpoint ?? ""),
          forcePathStyle: form.s3.forcePathStyle,
        },
        ...(form.s3AccessKeyId.trim()
          ? { s3AccessKeyId: form.s3AccessKeyId.trim() }
          : {}),
        ...(form.s3SecretAccessKey.trim()
          ? { s3SecretAccessKey: form.s3SecretAccessKey.trim() }
          : {}),
      })
      onChange(updated)
      if (toastOnSuccess) toast.success("Storage settings saved")
      onSaved?.()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't save storage settings"))
    } finally {
      setPending(false)
    }
  }

  const dirty = isDirty(form, storage)

  return (
    <form id={formId} onSubmit={onSubmit}>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>Storage</SectionTitle>
          </SectionHeader>
        )}
        <fieldset disabled={pending} className="contents">
          <SectionContent className="flex flex-col gap-0">
            <FormGroup
              title="Driver"
              description="Choose where Alloy stores user assets, clip sources, and thumbnails."
            >
              <Field>
                <FieldLabel htmlFor="storage-driver" required>
                  Storage driver
                </FieldLabel>
                <Select
                  value={form.driver}
                  onValueChange={(value) =>
                    set("driver", value as AdminStorageConfig["driver"])
                  }
                >
                  <SelectTrigger id="storage-driver" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="fs">Filesystem</SelectItem>
                    <SelectItem value="s3">S3 compatible</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FormGroup>

            <FormGroup
              title="Canonical paths"
              description={
                form.driver === "s3"
                  ? "Clips and users default to key prefixes under the storage prefix unless an override is set."
                  : "Clips and users default to folders under the storage path unless an override is set."
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="storage-path" required>
                    {form.driver === "s3" ? "Storage prefix" : "Storage path"}
                  </FieldLabel>
                  <Input
                    id="storage-path"
                    value={form.path}
                    placeholder="storage"
                    onChange={(e) => set("path", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="storage-clips-path">
                    Clips path override
                  </FieldLabel>
                  <Input
                    id="storage-clips-path"
                    value={form.clipsPath}
                    placeholder={`${form.path || "storage"}/clips`}
                    onChange={(e) => set("clipsPath", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="storage-users-path">
                    Users path override
                  </FieldLabel>
                  <Input
                    id="storage-users-path"
                    value={form.usersPath}
                    placeholder={`${form.path || "storage"}/users`}
                    onChange={(e) => set("usersPath", e.target.value)}
                  />
                </Field>
              </div>
            </FormGroup>

            {form.driver === "s3" ? (
              <FormGroup
                title="S3"
                description="Credentials are stored in server secrets and are not exported with runtime config."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="storage-s3-bucket" required>
                      Bucket
                    </FieldLabel>
                    <Input
                      id="storage-s3-bucket"
                      value={form.s3.bucket}
                      placeholder="my-clips"
                      onChange={(e) => setS3("bucket", e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="storage-s3-region" required>
                      Region
                    </FieldLabel>
                    <Input
                      id="storage-s3-region"
                      value={form.s3.region}
                      placeholder="us-east-1"
                      onChange={(e) => setS3("region", e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="storage-s3-endpoint">
                    Endpoint
                  </FieldLabel>
                  <Input
                    id="storage-s3-endpoint"
                    value={form.s3.endpoint ?? ""}
                    placeholder="https://s3.example.com"
                    onChange={(e) => setS3("endpoint", e.target.value)}
                  />
                  <p className="text-foreground-dim text-xs">
                    Leave blank for AWS S3. Set this for MinIO or other
                    S3-compatible providers.
                  </p>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel
                      htmlFor="storage-s3-access-key"
                      required={!storage.s3AccessKeyIdSet}
                    >
                      Access key ID
                    </FieldLabel>
                    <Input
                      id="storage-s3-access-key"
                      autoComplete="off"
                      value={form.s3AccessKeyId}
                      placeholder={
                        storage.s3AccessKeyIdSet ? "Already configured" : ""
                      }
                      onChange={(e) => set("s3AccessKeyId", e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel
                      htmlFor="storage-s3-secret-key"
                      required={!storage.s3SecretAccessKeySet}
                    >
                      Secret access key
                    </FieldLabel>
                    <Input
                      id="storage-s3-secret-key"
                      type="password"
                      autoComplete="off"
                      value={form.s3SecretAccessKey}
                      placeholder={
                        storage.s3SecretAccessKeySet ? "Already configured" : ""
                      }
                      onChange={(e) => set("s3SecretAccessKey", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex items-start justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Path-style URLs</div>
                    <p className="text-foreground-dim mt-0.5 text-xs">
                      Enable this for providers such as MinIO or some
                      self-hosted S3-compatible stores.
                    </p>
                  </div>
                  <Switch
                    checked={form.s3.forcePathStyle}
                    onCheckedChange={(next) => setS3("forcePathStyle", next)}
                  />
                </div>
              </FormGroup>
            ) : null}
          </SectionContent>

          {!hideActions && (
            <SectionFooter>
              <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                <Button
                  className="flex-1 sm:flex-initial"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  disabled={pending || !dirty}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 sm:flex-initial"
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={pending || !dirty}
                >
                  <SaveIcon />
                  {pending ? "Saving..." : "Save"}
                </Button>
              </div>
            </SectionFooter>
          )}
        </fieldset>
      </Section>
    </form>
  )
}
