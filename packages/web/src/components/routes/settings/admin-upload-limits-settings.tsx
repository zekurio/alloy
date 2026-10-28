import type { AdminRuntimeConfig, UploadLimits } from "@alloy/contracts"
import {
  LimitsConfigSchema,
  UploadLimitsSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PIXELS,
  UPLOAD_TTL_MAX_SEC,
  UPLOAD_TTL_MIN_SEC,
} from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { Input } from "@alloy/ui/components/input"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { useForm, useStore } from "@tanstack/react-form"

import { api } from "@/lib/api"

import { useAdminConfigMutation } from "./admin-config-context"
import { AdminDefaultNote } from "./admin-default-note"
import { SettingsSections, SettingsSubsection } from "./settings-panel"
import { useSettingsSaveBar } from "./settings-save-context"

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const FIELDS = [
  {
    key: "screenshotMaxBytes",
    label: message("Screenshot size (MiB)"),
    description: message(
      "Maximum size of an uploaded screenshot and its stored PNG.",
    ),
    scale: MIB,
    max: UPLOAD_MAX_BYTES,
  },
  {
    key: "screenshotMaxPixels",
    label: message("Screenshot resolution (megapixels)"),
    description: message(
      "Maximum width × height, including rotated screenshot edits.",
    ),
    scale: 1_000_000,
    max: UPLOAD_MAX_PIXELS,
  },
  {
    key: "avatarMaxBytes",
    label: message("Avatar size (MiB)"),
    description: message(
      "Applies to uploaded avatars and avatars synced from sign-in providers.",
    ),
    scale: MIB,
    max: UPLOAD_MAX_BYTES,
  },
  {
    key: "bannerMaxBytes",
    label: message("Profile banner size (MiB)"),
    description: message("Maximum size of an uploaded profile banner."),
    scale: MIB,
    max: UPLOAD_MAX_BYTES,
  },
  {
    key: "gameAssetMaxBytes",
    label: message("Game artwork size (MiB)"),
    description: message(
      "Maximum size of each uploaded game cover, hero, logo, or icon.",
    ),
    scale: MIB,
    max: UPLOAD_MAX_BYTES,
  },
] as const

function draftFromLimits(limits: UploadLimits): Record<string, string> {
  return Object.fromEntries(
    FIELDS.map((field) => [field.key, String(limits[field.key] / field.scale)]),
  )
}

function limitsFromDraft(
  draft: Record<string, string>,
): Record<string, number> {
  return Object.fromEntries(
    FIELDS.map((field) => [
      field.key,
      Math.round(Number(draft[field.key]) * field.scale),
    ]),
  )
}

export function UploadLimitsSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.uploadLimits
  const defaults = config.defaults.uploadLimits
  const saveLimits = useAdminConfigMutation(api.admin.updateUploadLimits)
  const saving = saveLimits.isPending
  const form = useForm({
    defaultValues: draftFromLimits(saved),
    onSubmit: async ({ value, formApi }) => {
      const result = UploadLimitsSchema.safeParse(limitsFromDraft(value))
      if (!result.success)
        throw new Error(t("Fix the invalid settings before saving."))
      const updated = await saveLimits.mutateAsync(result.data)
      formApi.reset(draftFromLimits(updated.uploadLimits), {
        keepDefaultValues: true,
      })
    },
  })
  const draft = useStore(form.store, (state) => state.values)

  const validation = UploadLimitsSchema.safeParse(limitsFromDraft(draft))
  const dirty = FIELDS.some(
    (field) =>
      Math.round(Number(draft[field.key]) * field.scale) !== saved[field.key],
  )

  useSettingsSaveBar(form, { dirty, saving, valid: validation.success })

  function renderFields(fields: readonly (typeof FIELDS)[number][]) {
    return (
      <SettingRows>
        {fields.map((field) => {
          const value = Math.round(Number(draft[field.key]) * field.scale)
          const invalid =
            !Number.isSafeInteger(value) || value <= 0 || value > field.max
          return (
            <SettingRow
              key={field.key}
              title={t(field.label)}
              description={
                <>
                  {t(field.description)}
                  <AdminDefaultNote
                    value={value}
                    defaultValue={defaults[field.key]}
                    label={String(defaults[field.key] / field.scale)}
                    disabled={saving}
                    onReset={() =>
                      form.setFieldValue(
                        field.key,
                        String(defaults[field.key] / field.scale),
                      )
                    }
                  />
                </>
              }
              htmlFor={field.key}
            >
              <Input
                id={field.key}
                type="number"
                inputMode="decimal"
                min={1 / field.scale}
                max={field.max / field.scale}
                step="any"
                value={draft[field.key] ?? ""}
                disabled={saving}
                aria-invalid={invalid || undefined}
                className="w-32"
                onChange={(event) =>
                  form.setFieldValue(field.key, event.target.value)
                }
              />
            </SettingRow>
          )
        })}
      </SettingRows>
    )
  }

  return (
    <SettingsSections>
      <SettingsSubsection
        id="screenshots"
        title={t("Screenshots")}
        description={t(
          "Changes apply immediately to new uploads, screenshot edits, and queued screenshots when processing starts.",
        )}
      >
        {renderFields(FIELDS.slice(0, 2))}
      </SettingsSubsection>
      <SettingsSubsection
        id="other-images"
        title={t("Profile images & artwork")}
        description={t(
          "File size limits before resizing. These images also have a 24-megapixel decoding limit.",
        )}
      >
        {renderFields(FIELDS.slice(2))}
      </SettingsSubsection>
      {!validation.success && (
        <Callout tone="destructive">
          {t("Enter positive limits up to {size} MiB or {pixels} megapixels.", {
            size: UPLOAD_MAX_BYTES / MIB,
            pixels: UPLOAD_MAX_PIXELS / 1_000_000,
          })}
        </Callout>
      )}
      <StorageLimitsSettings config={config} />
    </SettingsSections>
  )
}

type StorageLimitsDraft = { quotaGib: string; uploadTtlMinutes: string }

function storageDraft(
  limits: AdminRuntimeConfig["limits"],
): StorageLimitsDraft {
  return {
    quotaGib:
      limits.defaultStorageQuotaBytes === null
        ? ""
        : String(limits.defaultStorageQuotaBytes / GIB),
    uploadTtlMinutes: String(limits.uploadTtlSec / 60),
  }
}

/** An empty quota means unlimited storage. */
function limitsFromStorageDraft(draft: StorageLimitsDraft) {
  const quota = draft.quotaGib.trim()
  return {
    defaultStorageQuotaBytes: quota ? Math.round(Number(quota) * GIB) : null,
    uploadTtlSec: Math.round(Number(draft.uploadTtlMinutes) * 60),
  }
}

function quotaLabel(bytes: number | null): string {
  return bytes === null
    ? t("Unlimited")
    : t("{size} GiB", { size: bytes / GIB })
}

function StorageLimitsSettings({ config }: { config: AdminRuntimeConfig }) {
  const saved = config.limits
  const defaults = config.defaults.limits
  const saveLimits = useAdminConfigMutation(api.admin.updateLimits)
  const saving = saveLimits.isPending
  const form = useForm({
    defaultValues: storageDraft(saved),
    onSubmit: async ({ value, formApi }) => {
      const result = LimitsConfigSchema.safeParse(limitsFromStorageDraft(value))
      if (!result.success)
        throw new Error(t("Fix the invalid settings before saving."))
      const updated = await saveLimits.mutateAsync(result.data)
      formApi.reset(storageDraft(updated.limits), { keepDefaultValues: true })
    },
  })
  const draft = useStore(form.store, (state) => state.values)
  const next = limitsFromStorageDraft(draft)
  const validation = LimitsConfigSchema.safeParse(next)
  const dirty =
    next.defaultStorageQuotaBytes !== saved.defaultStorageQuotaBytes ||
    next.uploadTtlSec !== saved.uploadTtlSec

  useSettingsSaveBar(form, { dirty, saving, valid: validation.success })

  return (
    <SettingsSubsection
      id="storage-limits"
      title={t("Storage & uploads")}
      description={t(
        "Applies to accounts created from now on and to upload links issued after saving.",
      )}
    >
      <SettingRows>
        <SettingRow
          title={t("Default storage quota (GiB)")}
          description={
            <>
              {t(
                "Storage each new account starts with. Leave empty for unlimited; admins can change it per user.",
              )}
              <AdminDefaultNote
                value={next.defaultStorageQuotaBytes}
                defaultValue={defaults.defaultStorageQuotaBytes}
                label={quotaLabel(defaults.defaultStorageQuotaBytes)}
                disabled={saving}
                onReset={() =>
                  form.setFieldValue(
                    "quotaGib",
                    storageDraft(defaults).quotaGib,
                  )
                }
              />
            </>
          }
          htmlFor="default-storage-quota"
        >
          <Input
            id="default-storage-quota"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.quotaGib}
            placeholder={t("Unlimited")}
            disabled={saving}
            className="w-32"
            onChange={(event) =>
              form.setFieldValue("quotaGib", event.target.value)
            }
          />
        </SettingRow>
        <SettingRow
          title={t("Upload link lifetime (minutes)")}
          description={
            <>
              {t(
                "How long a clip upload has to finish before its upload link expires.",
              )}
              <AdminDefaultNote
                value={next.uploadTtlSec}
                defaultValue={defaults.uploadTtlSec}
                label={String(defaults.uploadTtlSec / 60)}
                disabled={saving}
                onReset={() =>
                  form.setFieldValue(
                    "uploadTtlMinutes",
                    storageDraft(defaults).uploadTtlMinutes,
                  )
                }
              />
            </>
          }
          htmlFor="upload-ttl"
        >
          <Input
            id="upload-ttl"
            type="number"
            inputMode="decimal"
            min={UPLOAD_TTL_MIN_SEC / 60}
            max={UPLOAD_TTL_MAX_SEC / 60}
            step="any"
            value={draft.uploadTtlMinutes}
            disabled={saving}
            aria-invalid={validation.success ? undefined : true}
            className="w-32"
            onChange={(event) =>
              form.setFieldValue("uploadTtlMinutes", event.target.value)
            }
          />
        </SettingRow>
      </SettingRows>
      {!validation.success && (
        <Callout tone="destructive" className="mt-3">
          {t(
            "Enter a positive quota, or leave it empty, and an upload link lifetime from {min} to {max} minutes.",
            { min: UPLOAD_TTL_MIN_SEC / 60, max: UPLOAD_TTL_MAX_SEC / 60 },
          )}
        </Callout>
      )}
    </SettingsSubsection>
  )
}
