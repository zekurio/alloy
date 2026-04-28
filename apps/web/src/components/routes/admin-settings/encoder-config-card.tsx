import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  PlusIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/lib/toast"
import { Switch } from "@workspace/ui/components/switch"

import {
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
} from "@workspace/api"

import { api } from "@/lib/api"
import { EncoderVariantDialog } from "./encoder-variant-dialog"
import { FormGroup } from "./form-group"
import { ReEncodeClipsButton } from "./re-encode-clips-card"
import { VariantRow } from "./encoder-variant-row"
import { FfmpegBadge } from "./encoder-ffmpeg-badge"
import {
  HWACCEL_LABELS,
  isEncoderHwaccel,
  openGraphDisplayLabel,
  openGraphValue,
  saveEncoderConfig,
  variantCodecAvailable,
  variantIdFromName,
} from "./encoder-config-helpers"

type EncoderConfigCardProps = {
  encoder: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Called after a successful save (or when submitted with no changes). */
  onSaved?: () => void
  /** Hide the footer action buttons (Cancel / Save). */
  hideActions?: boolean
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
  /** HTML `id` for the `<form>` element, useful for external submit buttons. */
  formId?: string
}

/** Index of the variant being edited, or -1 for a new variant, or null when closed. */
type DialogState = number | null

export function EncoderConfigCard({
  encoder,
  onChange,
  onSaved,
  hideActions,
  hideHeader,
  formId,
}: EncoderConfigCardProps) {
  const [form, setForm] = React.useState<AdminEncoderConfig>(encoder)
  const [pending, setPending] = React.useState(false)
  const [dialogState, setDialogState] = React.useState<DialogState>(null)
  const capsQuery = useQuery({
    queryKey: ["admin", "encoder-capabilities"],
    queryFn: () => api.admin.fetchEncoderCapabilities(),
    staleTime: 5 * 60_000,
  })
  const caps = capsQuery.data ?? null
  const capsError = capsQuery.error
    ? capsQuery.error instanceof Error
      ? capsQuery.error.message
      : "Couldn't probe ffmpeg capabilities"
    : null

  React.useEffect(() => {
    setForm(encoder)
  }, [encoder])

  function resetForm() {
    setForm(encoder)
  }

  function set<K extends keyof AdminEncoderConfig>(
    key: K,
    value: AdminEncoderConfig[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setEncodingEnabled(next: boolean) {
    setForm((f) => ({ ...f, enabled: next }))
    if (next && form.variants.length === 0) {
      setDialogState(-1)
    }
  }

  function removeVariant(index: number) {
    setForm((f) => {
      const removed = f.variants[index]
      const variants = f.variants.filter((_, i) => i !== index)
      const nextDefault =
        removed?.id === f.defaultVariantId
          ? (variants[0]?.id ?? null)
          : f.defaultVariantId
      const openGraphTarget =
        f.openGraphTarget.type === "variant" &&
        f.openGraphTarget.variantId === removed?.id
          ? ({ type: "source" } as const)
          : f.openGraphTarget
      return {
        ...f,
        defaultVariantId: nextDefault,
        openGraphTarget,
        variants,
      }
    })
  }

  function setDefaultVariant(index: number) {
    setForm((f) => ({ ...f, defaultVariantId: f.variants[index]?.id ?? null }))
  }

  function setOpenGraphValue(value: string | null) {
    if (!value) return
    setForm((f) => {
      if (value === "none") return { ...f, openGraphTarget: { type: "none" } }
      if (value === "source") {
        return { ...f, openGraphTarget: { type: "source" } }
      }
      if (value === "defaultVariant") {
        return { ...f, openGraphTarget: { type: "defaultVariant" } }
      }
      if (value.startsWith("variant:")) {
        return {
          ...f,
          openGraphTarget: {
            type: "variant",
            variantId: value.slice("variant:".length),
          },
        }
      }
      return f
    })
  }

  function openNewVariant() {
    setDialogState(-1)
  }

  function openEditVariant(index: number) {
    setDialogState(index)
  }

  function handleDialogSave(variant: AdminEncoderVariant) {
    const usedIds = new Set(
      form.variants
        .filter((_, i) => i !== dialogState)
        .map((existing) => existing.id)
    )
    const normalizedVariant = {
      ...variant,
      id: variant.id || variantIdFromName(variant.name, usedIds),
    }
    if (dialogState === -1) {
      setForm((f) => ({
        ...f,
        enabled: true,
        defaultVariantId: f.defaultVariantId ?? normalizedVariant.id,
        variants: [...f.variants, normalizedVariant],
      }))
    } else if (dialogState !== null) {
      setForm((f) => ({
        ...f,
        defaultVariantId:
          f.variants[dialogState]?.id === f.defaultVariantId
            ? normalizedVariant.id
            : f.defaultVariantId,
        openGraphTarget:
          f.openGraphTarget.type === "variant" &&
          f.openGraphTarget.variantId === f.variants[dialogState]?.id
            ? { type: "variant", variantId: normalizedVariant.id }
            : f.openGraphTarget,
        variants: f.variants.map((v, i) =>
          i === dialogState ? normalizedVariant : v
        ),
      }))
    }
    setDialogState(null)
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open) {
      if (dialogState === -1 && !encoder.enabled) {
        setForm((f) => (f.variants.length === 0 ? { ...f, enabled: false } : f))
      }
      setDialogState(null)
    }
  }

  const dialogVariant: AdminEncoderVariant | null =
    dialogState === -1
      ? {
          id: "",
          name: "",
          codec: "h264",
          height: 1080,
          quality: 23,
          audioBitrateKbps: 128,
          extraInputArgs: "",
          extraOutputArgs: "",
        }
      : dialogState !== null
        ? (form.variants[dialogState] ?? null)
        : null

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!isDirty) {
      onSaved?.()
      return
    }
    if (!form.enabled) {
      await saveEncoderConfig({ form, onChange, setPending, onSaved })
      return
    }
    if (form.variants.length === 0) {
      toast.error("Add at least one variant or disable variant encoding.")
      return
    }
    for (const variant of form.variants) {
      if (variant.name.trim() === "") {
        toast.error("Every variant needs a name.")
        return
      }
      const h = variant.height
      if (
        !Number.isInteger(h) ||
        h < ENCODER_HEIGHT_MIN ||
        h > ENCODER_HEIGHT_MAX ||
        h % 2 !== 0
      ) {
        toast.error(
          `Variant heights must be even integers between ${ENCODER_HEIGHT_MIN} and ${ENCODER_HEIGHT_MAX}.`
        )
        return
      }
      if (!variantCodecAvailable(caps, form.hwaccel, variant)) {
        toast.error(`${variant.name} uses an encoder unavailable in ffmpeg.`)
        return
      }
    }
    await saveEncoderConfig({ form, onChange, setPending, onSaved })
  }

  const isDirty = JSON.stringify(form) !== JSON.stringify(encoder)
  const hasInvalidVariantName = form.variants.some(
    (variant) => variant.name.trim() === ""
  )
  const hasInvalidHeight = form.variants.some(
    (variant) =>
      !Number.isInteger(variant.height) ||
      variant.height < ENCODER_HEIGHT_MIN ||
      variant.height > ENCODER_HEIGHT_MAX ||
      variant.height % 2 !== 0
  )
  const unsupportedVariant = form.variants.find(
    (variant) => !variantCodecAvailable(caps, form.hwaccel, variant)
  )
  const selectedDevice =
    form.hwaccel === "qsv"
      ? {
          key: "qsvDevice" as const,
          id: "encoder-qsv-device",
          label: "QSV device",
          description: "Device path used for Intel Quick Sync encodes.",
        }
      : form.hwaccel === "vaapi"
        ? {
            key: "vaapiDevice" as const,
            id: "encoder-vaapi-device",
            label: "VAAPI device",
            description: "Device path used for VAAPI hardware encodes.",
          }
        : null
  const canSubmit =
    isDirty &&
    !pending &&
    (!form.enabled ||
      (!unsupportedVariant &&
        !hasInvalidVariantName &&
        !hasInvalidHeight &&
        form.variants.length > 0))
  const sortedVariants = form.variants
    .map((variant, index) => ({ variant, index }))
    .sort((a, b) => b.variant.height - a.variant.height)
  return (
    <>
      <form id={formId} onSubmit={onSubmit}>
        <Section>
          {!hideHeader && (
            <SectionHeader>
              <SectionTitle>Encoder</SectionTitle>
              <FfmpegBadge caps={caps} error={capsError} />
            </SectionHeader>
          )}

          <fieldset disabled={pending} className="contents">
            <SectionContent className="flex flex-col gap-0">
              {/* ── Hardware ── */}
              <FormGroup
                title="Hardware acceleration"
                description="GPU backend used for all generated variants."
              >
                {hideHeader && <FfmpegBadge caps={caps} error={capsError} />}
                <Field>
                  <FieldLabel htmlFor="encoder-hwaccel">Backend</FieldLabel>
                  <Select
                    value={form.hwaccel}
                    onValueChange={(value) => {
                      if (isEncoderHwaccel(value)) set("hwaccel", value)
                    }}
                  >
                    <SelectTrigger id="encoder-hwaccel" className="w-full">
                      <SelectValue>{HWACCEL_LABELS[form.hwaccel]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {ENCODER_HWACCELS.map((hwaccel) => (
                        <SelectItem key={hwaccel} value={hwaccel}>
                          {HWACCEL_LABELS[hwaccel]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {selectedDevice ? (
                  <Field>
                    <FieldLabel htmlFor={selectedDevice.id}>
                      {selectedDevice.label}
                    </FieldLabel>
                    <Input
                      id={selectedDevice.id}
                      value={form[selectedDevice.key]}
                      placeholder="/dev/dri/renderD128"
                      onChange={(e) => set(selectedDevice.key, e.target.value)}
                    />
                    <FieldDescription>
                      {selectedDevice.description}
                    </FieldDescription>
                  </Field>
                ) : null}

                {unsupportedVariant ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      The detected ffmpeg build does not report support for
                      every configured variant codec with{" "}
                      {HWACCEL_LABELS[form.hwaccel]}.
                    </span>
                  </div>
                ) : null}
              </FormGroup>

              {/* ── Processing pipeline ── */}
              <FormGroup
                title="Processing"
                description="Control how uploaded clips are processed before playback."
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <FieldLabel htmlFor="encoder-remux-enabled">
                      Remux source to MP4
                    </FieldLabel>
                    <p className="text-xs text-muted-foreground">
                      Publish a browser-friendly Source stream before background
                      variants finish.
                    </p>
                  </div>
                  <Switch
                    id="encoder-remux-enabled"
                    checked={form.remuxEnabled}
                    onCheckedChange={(next) => set("remuxEnabled", next)}
                    aria-label="Enable source remux"
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <FieldLabel htmlFor="encoder-enabled">
                      Variant encoding
                    </FieldLabel>
                    <p className="text-xs text-muted-foreground">
                      Generate MP4 playback renditions with the variant ladder
                      below.
                    </p>
                  </div>
                  <Switch
                    id="encoder-enabled"
                    checked={form.enabled}
                    onCheckedChange={setEncodingEnabled}
                    aria-label="Enable variant encoding"
                  />
                </div>

                {!form.enabled && !form.remuxEnabled ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Remux and variant encoding are disabled. Uploaded source
                      files become the default stream, which can break playback
                      and OpenGraph embeds.
                    </span>
                  </div>
                ) : null}
              </FormGroup>

              {/* ── Sharing ── */}
              <FormGroup
                title="Sharing"
                description="Configure how clips appear in link previews."
              >
                <Field>
                  <FieldLabel htmlFor="encoder-open-graph">
                    OpenGraph video
                  </FieldLabel>
                  <Select
                    value={openGraphValue(form)}
                    onValueChange={setOpenGraphValue}
                  >
                    <SelectTrigger id="encoder-open-graph" className="w-full">
                      <SelectValue>{openGraphDisplayLabel(form)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="none">No video</SelectItem>
                      <SelectItem value="source">Source MP4</SelectItem>
                      <SelectItem value="defaultVariant">
                        Default playback variant
                      </SelectItem>
                      {form.variants.map((variant) => (
                        <SelectItem
                          key={variant.id}
                          value={`variant:${variant.id}`}
                        >
                          {variant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Missing targets are omitted from metadata instead of
                    emitting broken video URLs.
                  </FieldDescription>
                </Field>
              </FormGroup>

              {/* ── Variant ladder ── */}
              {form.enabled ? (
                <FormGroup
                  title="Variant ladder"
                  description="Renditions generated for each uploaded clip. Star a variant to set the default playback quality."
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Expose source</div>
                      <p className="text-xs text-muted-foreground">
                        Offer the published source as an opt-in "Source" quality
                        when variant encoding runs.
                      </p>
                    </div>
                    <Switch
                      checked={form.keepSource}
                      onCheckedChange={(next) => set("keepSource", next)}
                      aria-label="Keep source"
                    />
                  </div>

                  {form.variants.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {sortedVariants.map(({ variant, index }) => (
                        <VariantRow
                          key={`${variant.name}-${variant.height}-${index}`}
                          variant={variant}
                          isDefault={variant.id === form.defaultVariantId}
                          canDelete
                          onEdit={() => openEditVariant(index)}
                          onSetDefault={() => setDefaultVariant(index)}
                          onDelete={() => removeVariant(index)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      No variants configured. Add one to get started.
                    </p>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={openNewVariant}
                    disabled={pending}
                  >
                    <PlusIcon />
                    Add variant
                  </Button>
                </FormGroup>
              ) : null}

              {/* ── Re-encode (admin settings only) ── */}
              {form.enabled && !hideActions ? (
                <FormGroup
                  title="Re-encode existing clips"
                  description="Queue current clips against the saved variant ladder."
                >
                  <ReEncodeClipsButton />
                </FormGroup>
              ) : null}
            </SectionContent>

            {!hideActions && (
              <SectionFooter>
                <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                  <Button
                    className="flex-1 sm:flex-initial"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetForm}
                    disabled={pending || !isDirty}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 sm:flex-initial"
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!canSubmit}
                  >
                    {pending ? "Saving…" : "Save encoder"}
                  </Button>
                </div>
              </SectionFooter>
            )}
          </fieldset>
        </Section>
      </form>

      <EncoderVariantDialog
        variant={dialogVariant}
        isNew={dialogState === -1}
        hwaccel={form.hwaccel}
        capabilities={caps}
        onSave={handleDialogSave}
        onOpenChange={handleDialogOpenChange}
      />
    </>
  )
}
