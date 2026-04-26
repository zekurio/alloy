import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HWACCELS,
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
  type EncoderHwaccel,
} from "@workspace/api"

import { api } from "@/lib/api"
import { EncoderVariantDialog } from "./encoder-variant-dialog"
import { ReEncodeClipsButton } from "./re-encode-clips-card"
import { VariantRow } from "./encoder-variant-row"

type EncoderConfigCardProps = {
  encoder: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
}

/** Index of the variant being edited, or -1 for a new variant, or null when closed. */
type DialogState = number | null

const HWACCEL_LABELS: Record<EncoderHwaccel, string> = {
  none: "None",
  amf: "AMD AMF",
  nvenc: "Nvidia NVENC",
  qsv: "Intel Quicksync (QSV)",
  rkmpp: "Rockchip MPP (RKMPP)",
  vaapi: "Video Acceleration API (VAAPI)",
  videotoolbox: "Apple VideoToolBox",
  v4l2m2m: "Video4Linux2 (V4L2)",
}

function isEncoderHwaccel(
  value: string | number | null
): value is EncoderHwaccel {
  return (
    typeof value === "string" &&
    ENCODER_HWACCELS.includes(value as EncoderHwaccel)
  )
}

function variantCodecAvailable(
  caps: AdminEncoderCapabilities | null,
  hwaccel: EncoderHwaccel,
  variant: AdminEncoderVariant
): boolean {
  return caps?.ffmpegOk
    ? (caps.available[hwaccel]?.[variant.codec] ?? false)
    : true
}

async function saveEncoderConfig({
  form,
  onChange,
  setPending,
}: {
  form: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
  setPending: React.Dispatch<React.SetStateAction<boolean>>
}) {
  setPending(true)
  try {
    const next = await api.admin.updateEncoderConfig(form)
    onChange(next)
    toast.success("Encoder updated")
  } catch (cause) {
    toast.error(
      cause instanceof Error ? cause.message : "Couldn't update encoder"
    )
  } finally {
    setPending(false)
  }
}

export function EncoderConfigCard({
  encoder,
  onChange,
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
    setForm((f) => ({
      ...f,
      variants: f.variants.filter((_, i) => i !== index),
    }))
  }

  function setDefaultVariant(index: number) {
    setForm((f) => {
      if (index <= 0 || index >= f.variants.length) return f
      const next = [...f.variants]
      const [selected] = next.splice(index, 1)
      if (!selected) return f
      next.unshift(selected)
      return { ...f, variants: next }
    })
  }

  function openNewVariant() {
    setDialogState(-1)
  }

  function openEditVariant(index: number) {
    setDialogState(index)
  }

  function handleDialogSave(variant: AdminEncoderVariant) {
    if (dialogState === -1) {
      setForm((f) => ({
        ...f,
        enabled: true,
        variants: [...f.variants, variant],
      }))
    } else if (dialogState !== null) {
      setForm((f) => ({
        ...f,
        variants: f.variants.map((v, i) => (i === dialogState ? variant : v)),
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
    if (!form.enabled) {
      await saveEncoderConfig({ form, onChange, setPending })
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
    await saveEncoderConfig({ form, onChange, setPending })
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
    .sort((a, b) =>
      a.variant.name.localeCompare(b.variant.name, undefined, {
        sensitivity: "base",
      })
    )
  return (
    <>
      <form onSubmit={onSubmit}>
        <Section>
          <SectionHeader>
            <SectionTitle>Encoder</SectionTitle>
          </SectionHeader>

          <fieldset disabled={pending} className="contents">
            <SectionContent className="flex flex-col gap-3">
              {capsError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{capsError}</span>
                </div>
              ) : null}

              {caps && !caps.ffmpegOk ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    ffmpeg isn&rsquo;t reachable on the server. Encodes will
                    fail until the binary is on PATH (or <code>FFMPEG_BIN</code>{" "}
                    points at it).
                  </span>
                </div>
              ) : null}

              {caps?.ffmpegVersion ? (
                <p className="text-xs text-muted-foreground">
                  Detected:{" "}
                  <span className="font-mono">{caps.ffmpegVersion}</span>
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="encoder-hwaccel">
                    Hardware acceleration
                  </FieldLabel>
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
                  <FieldDescription>
                    Applies to every generated variant.
                  </FieldDescription>
                </Field>
              </div>

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
                    The detected ffmpeg build does not report support for every
                    configured variant codec with {HWACCEL_LABELS[form.hwaccel]}
                    .
                  </span>
                </div>
              ) : null}

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

              {!form.enabled ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Variant encoding is disabled. Uploaded source files become
                    the default stream, which can break OpenGraph embeds when
                    the source is not browser-friendly MP4.
                  </span>
                </div>
              ) : null}

              {form.enabled ? (
                <>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-medium">Variant ladder</h3>
                      <Tooltip>
                        <TooltipTrigger className="text-muted-foreground hover:text-foreground">
                          <InfoIcon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start">
                          Star a variant to make it the default playback
                          rendition. Heights above source are clamped. Duplicate
                          resolutions are allowed when codec, quality, or
                          bitrate targets differ.
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Expose source</div>
                        <p className="text-xs text-muted-foreground">
                          Offer the original upload as an opt-in "Source"
                          quality.
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
                            isDefault={index === 0}
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
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        Re-encode existing clips
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Queue current clips against the saved variant ladder.
                      </p>
                    </div>
                    <ReEncodeClipsButton />
                  </div>
                </>
              ) : null}
            </SectionContent>

            <SectionFooter>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                  disabled={pending || !isDirty}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit}
                >
                  {pending ? "Saving…" : "Save encoder"}
                </Button>
              </div>
            </SectionFooter>
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
