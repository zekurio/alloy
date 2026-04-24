import * as React from "react"
import { AlertCircleIcon, AlertTriangleIcon, PlusIcon } from "lucide-react"

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
import { Switch } from "@workspace/ui/components/switch"

import {
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
} from "@workspace/api"

import { api } from "@/lib/api"
import { EncoderVariantDialog } from "./encoder-variant-dialog"
import { VariantRow } from "./encoder-variant-row"

type EncoderConfigCardProps = {
  encoder: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
}

/** Index of the variant being edited, or -1 for a new variant, or null when closed. */
type DialogState = number | null

export function EncoderConfigCard({
  encoder,
  onChange,
}: EncoderConfigCardProps) {
  const [form, setForm] = React.useState<AdminEncoderConfig>(encoder)
  const [pending, setPending] = React.useState(false)
  const [caps, setCaps] = React.useState<AdminEncoderCapabilities | null>(null)
  const [capsError, setCapsError] = React.useState<string | null>(null)
  const [dialogState, setDialogState] = React.useState<DialogState>(null)

  React.useEffect(() => {
    setForm(encoder)
  }, [encoder])

  function resetForm() {
    setForm(encoder)
  }

  React.useEffect(() => {
    let cancelled = false
    api.admin
      .fetchEncoderCapabilities()
      .then((next) => {
        if (!cancelled) setCaps(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setCapsError(
          cause instanceof Error
            ? cause.message
            : "Couldn't probe ffmpeg capabilities"
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  function moveVariant(index: number, direction: -1 | 1) {
    setForm((f) => {
      const target = index + direction
      if (target < 0 || target >= f.variants.length) return f
      const next = [...f.variants]
      const [moved] = next.splice(index, 1)
      if (!moved) return f
      next.splice(target, 0, moved)
      return { ...f, variants: next }
    })
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
      // Adding new variant
      setForm((f) => ({
        ...f,
        enabled: true,
        variants: [...f.variants, variant],
      }))
    } else if (dialogState !== null) {
      // Editing existing variant
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
          hwaccel: "software",
          height: 1080,
          codec: "h264",
          quality: 23,
          audioBitrateKbps: 128,
        }
      : dialogState !== null
        ? (form.variants[dialogState] ?? null)
        : null

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!form.enabled) {
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
    }
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
  const canSubmit =
    isDirty &&
    !pending &&
    (!form.enabled ||
      (!hasInvalidVariantName &&
        !hasInvalidHeight &&
        form.variants.length > 0))
  const usesQsv = form.variants.some((variant) => variant.hwaccel === "qsv")
  const usesVaapi = form.variants.some((variant) => variant.hwaccel === "vaapi")

  return (
    <>
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Encoder</CardTitle>
          </CardHeader>

          <fieldset disabled={pending} className="contents">
            <CardContent className="flex flex-col gap-3">
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
                  {usesQsv ? (
                    <Field>
                      <FieldLabel htmlFor="encoder-qsv-device" required>
                        QSV device
                      </FieldLabel>
                      <Input
                        id="encoder-qsv-device"
                        value={form.qsvDevice}
                        required
                        onChange={(e) => set("qsvDevice", e.target.value)}
                        placeholder="/dev/dri/renderD128"
                      />
                      <FieldDescription className="text-xs leading-snug">
                        Passed to ffmpeg as QSV&rsquo;s{" "}
                        <code>child_device</code>. Use a DRM render node on
                        Linux or an adapter index on Windows.
                      </FieldDescription>
                    </Field>
                  ) : null}

                  {usesVaapi ? (
                    <Field>
                      <FieldLabel htmlFor="encoder-vaapi-device" required>
                        VA-API device
                      </FieldLabel>
                      <Input
                        id="encoder-vaapi-device"
                        value={form.vaapiDevice}
                        required
                        onChange={(e) => set("vaapiDevice", e.target.value)}
                        placeholder="/dev/dri/renderD128"
                      />
                      <FieldDescription className="text-xs leading-snug">
                        Path to the DRM render node passed to ffmpeg&rsquo;s{" "}
                        <code>-vaapi_device</code>. Only used when the backend
                        is VA-API.
                      </FieldDescription>
                    </Field>
                  ) : null}

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="text-sm font-medium">Variant ladder</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={openNewVariant}
                        disabled={pending}
                      >
                        <PlusIcon />
                        Add variant
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Star a variant to make it the default playback rendition.
                      Heights above source are clamped. Duplicate resolutions
                      are allowed when codec, quality, or bitrate targets
                      differ.
                    </p>

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
                        {form.variants.map((variant, index) => (
                          <VariantRow
                            key={`${variant.name}-${variant.height}-${variant.codec}-${index}`}
                            variant={variant}
                            isDefault={index === 0}
                            canMoveUp={index > 0}
                            canMoveDown={index < form.variants.length - 1}
                            canDelete
                            onEdit={() => openEditVariant(index)}
                            onSetDefault={() => setDefaultVariant(index)}
                            onMoveUp={() => moveVariant(index, -1)}
                            onMoveDown={() => moveVariant(index, 1)}
                            onDelete={() => removeVariant(index)}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="py-3 text-center text-sm text-muted-foreground">
                        No variants configured. Add one to get started.
                      </p>
                    )}
                  </div>
                </>
              ) : null}
            </CardContent>

            <CardFooter>
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
            </CardFooter>
          </fieldset>
        </Card>
      </form>

      <EncoderVariantDialog
        variant={dialogVariant}
        isNew={dialogState === -1}
        caps={caps}
        qsvDevice={form.qsvDevice}
        vaapiDevice={form.vaapiDevice}
        onDeviceChange={(key, value) => set(key, value)}
        onSave={handleDialogSave}
        onOpenChange={handleDialogOpenChange}
      />
    </>
  )
}
