import {
  type AdminRuntimeConfig,
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Input } from "@alloy/ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon, SaveIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { TranscodingLadder } from "@/components/routes/settings/admin-transcoding-ladder"
import {
  compatTierCodec,
  ffmpegBadgeLabel,
  findProbe,
  formFromConfig,
  formsEqual,
  type TranscodingForm,
  validateForm,
  AUDIO_BITRATES,
  HARDWARE_ACCELERATION_LABELS,
  VIDEO_CODEC_LABELS,
} from "@/components/routes/settings/admin-transcoding-validation"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import {
  adminKeys,
  adminTranscodingCapabilitiesQueryOptions,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

export function TranscodingSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.transcoding
  const [form, setForm] = useState<TranscodingForm>(() => formFromConfig(saved))
  const [saving, setSaving] = useState(false)
  const [redetecting, setRedetecting] = useState(false)
  const queryClient = useQueryClient()
  const capabilitiesQuery = useQuery(adminTranscodingCapabilitiesQueryOptions())
  const capabilities = capabilitiesQuery.data ?? null

  // The saved config is the source of truth: reset the draft whenever the
  // server hands back a new one (after a save it may be normalized/clamped).
  useEffect(() => {
    setForm(formFromConfig(saved))
  }, [saved])

  const validation = useMemo(
    () => validateForm(form, capabilities),
    [form, capabilities],
  )
  const dirty = useMemo(() => !formsEqual(form, saved), [form, saved])
  const selectedProbe =
    form.hardwareAcceleration === "none" || !capabilities
      ? null
      : findProbe(capabilities, form.videoCodec, form.hardwareAcceleration)
  // The link-preview tier doubles as the OpenGraph/compat rendition, so social
  // embed support hinges on its effective codec, not the global default.
  const compatCodec = compatTierCodec(form)

  async function save() {
    if (saving || !dirty) return
    if (!validation.valid) {
      if (validation.message) toast.error(validation.message)
      return
    }
    setSaving(true)
    try {
      const updated = await api.admin.updateTranscodingConfig({
        videoCodec: form.videoCodec,
        hardwareAcceleration: form.hardwareAcceleration,
        vaapiDevice: form.vaapiDevice.trim(),
        quality: form.quality,
        audioBitrateKbps: form.audioBitrateKbps,
        tiers: form.tiers.map((tier) => ({
          height: tier.height,
          maxFps: tier.maxFps,
          maxrateKbps: tier.maxrateKbps,
          ...(tier.codec ? { codec: tier.codec } : {}),
          ...(tier.og ? { og: true } : {}),
        })),
      })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      toast.success(t("Transcoding settings saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save transcoding settings")))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(formFromConfig(saved))
  }

  async function reDetect() {
    if (redetecting) return
    setRedetecting(true)
    try {
      const next = await api.admin.fetchTranscodingCapabilities({
        refresh: true,
      })
      queryClient.setQueryData(adminKeys.transcodingCapabilities(), next)
      toast.success(t("Encoder detection refreshed"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't detect encoders")))
    } finally {
      setRedetecting(false)
    }
  }

  const inSettingsDialog = useSettingsSaveBar({ dirty, saving, save, discard })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-6 py-0">
        <p className="text-foreground-dim text-xs">
          {t(
            "How the server transcodes new uploads: video codec, optional GPU encoding, quality, audio, and the ladder of renditions used for quality switching.",
          )}
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              {t("Codec & encoding")}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              {capabilities?.version ? (
                <Badge
                  variant={capabilities.jellyfin ? "accent" : "default"}
                  size="text"
                >
                  {ffmpegBadgeLabel(capabilities)}
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reDetect}
                disabled={redetecting || capabilitiesQuery.isLoading}
                className="shrink-0"
              >
                <RefreshCwIcon className={redetecting ? "animate-spin" : ""} />
                {redetecting ? t("Detecting...") : t("Re-detect")}
              </Button>
            </div>
          </div>

          <p className="text-foreground-dim -mt-2 text-xs">
            {capabilitiesQuery.isLoading
              ? t("Detecting encoders...")
              : (capabilities?.version ?? t("ffmpeg not detected"))}
          </p>

          <SettingRow
            title={t("Video codec")}
            description={t(
              "Default codec for every rendition. Individual tiers in the ladder can override it.",
            )}
            htmlFor="transcoding-codec"
            align="start"
          >
            <Select
              value={form.videoCodec}
              onValueChange={(value) => {
                const codec = TRANSCODE_VIDEO_CODECS.find(
                  (option) => option === value,
                )
                if (codec) setForm((prev) => ({ ...prev, videoCodec: codec }))
              }}
            >
              <SelectTrigger id="transcoding-codec" size="sm" className="w-48">
                <SelectValue>{VIDEO_CODEC_LABELS[form.videoCodec]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {TRANSCODE_VIDEO_CODECS.map((codec) => (
                  <SelectItem key={codec} value={codec}>
                    {VIDEO_CODEC_LABELS[codec]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {compatCodec !== "h264" ? (
            <Callout tone="warning" className="text-xs">
              <TriangleAlertIcon />
              {t(
                "Social embeds (Discord, Slack, X) need H.264 video. With HEVC or AV1 on the link preview tier, the server stops adding video embed tags, so shared links fall back to a thumbnail card instead of an inline player.",
              )}
            </Callout>
          ) : null}

          <SettingRow
            title={t("Hardware acceleration")}
            description={t(
              "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.",
            )}
            htmlFor="transcoding-hwaccel"
            align="start"
          >
            <Select
              value={form.hardwareAcceleration}
              onValueChange={(value) => {
                const accel = HARDWARE_ACCELERATIONS.find(
                  (option) => option === value,
                )
                if (accel) {
                  setForm((prev) => ({ ...prev, hardwareAcceleration: accel }))
                }
              }}
            >
              <SelectTrigger
                id="transcoding-hwaccel"
                size="sm"
                className="w-56"
              >
                <SelectValue>
                  {HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {HARDWARE_ACCELERATIONS.map((accel) => {
                  const probe =
                    accel === "none" || !capabilities
                      ? null
                      : findProbe(capabilities, form.videoCodec, accel)
                  const unavailable =
                    accel !== "none" &&
                    capabilities !== null &&
                    probe?.status !== "ok"
                  return (
                    <SelectItem
                      key={accel}
                      value={accel}
                      disabled={unavailable}
                    >
                      {HARDWARE_ACCELERATION_LABELS[accel]}
                      {unavailable ? ` ${t("(unavailable)")}` : ""}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </SettingRow>

          {selectedProbe && selectedProbe.status !== "ok" ? (
            <Callout tone="destructive" className="text-xs">
              <TriangleAlertIcon />
              {selectedProbe.status === "missing"
                ? t(
                    "This ffmpeg build has no {backend} encoder for {codec}. Pick another backend or install jellyfin-ffmpeg.",
                    {
                      backend:
                        HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
                      codec: VIDEO_CODEC_LABELS[form.videoCodec],
                    },
                  )
                : t(
                    "The {backend} encoder for {codec} failed its test on this server. Pick another backend or check the GPU drivers.",
                    {
                      backend:
                        HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
                      codec: VIDEO_CODEC_LABELS[form.videoCodec],
                    },
                  )}
              {selectedProbe.error ? (
                <span className="text-foreground-muted text-2xs mt-1 block font-mono break-words">
                  {selectedProbe.error}
                </span>
              ) : null}
            </Callout>
          ) : null}

          {form.hardwareAcceleration === "vaapi" ? (
            <SettingRow
              title={t("VA-API device")}
              description={t(
                "Render node passed to ffmpeg for VA-API encoding.",
              )}
              htmlFor="transcoding-vaapi-device"
              align="start"
            >
              <div className="flex w-56 flex-col gap-1.5">
                <Input
                  id="transcoding-vaapi-device"
                  value={form.vaapiDevice}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      vaapiDevice: event.target.value,
                    }))
                  }
                  placeholder="/dev/dri/renderD128"
                  aria-invalid={
                    validation.vaapiDeviceMessage ? true : undefined
                  }
                />
                {validation.vaapiDeviceMessage ? (
                  <p className="text-destructive text-2xs">
                    {validation.vaapiDeviceMessage}
                  </p>
                ) : null}
              </div>
            </SettingRow>
          ) : null}
        </div>

        <div className="border-border flex flex-col gap-4 border-t pt-6">
          <span className="text-sm font-semibold">{t("Audio")}</span>

          <SettingRow
            title={t("Audio bitrate")}
            description={t("Stereo AAC bitrate applied to every rendition.")}
            htmlFor="transcoding-audio"
            align="start"
          >
            <Select
              value={String(form.audioBitrateKbps)}
              onValueChange={(value) => {
                const kbps = AUDIO_BITRATES.find(
                  (option) => String(option) === value,
                )
                if (kbps) {
                  setForm((prev) => ({ ...prev, audioBitrateKbps: kbps }))
                }
              }}
            >
              <SelectTrigger id="transcoding-audio" size="sm" className="w-48">
                <SelectValue>
                  {t("{kbps} kbps", { kbps: form.audioBitrateKbps })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {AUDIO_BITRATES.map((kbps) => (
                  <SelectItem key={kbps} value={String(kbps)}>
                    {t("{kbps} kbps", { kbps })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>

        <TranscodingLadder
          form={form}
          validation={validation}
          setForm={setForm}
        />

        <div className="border-border border-t pt-6">
          <p className="text-foreground-dim text-xs">
            {t(
              "Changes apply to new uploads. Existing clips re-encode automatically when their renditions no longer match; you can also trigger a sweep from the Jobs panel.",
            )}
          </p>
        </div>
      </SectionContent>
      {!inSettingsDialog && (
        <SectionFooter>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={saving || !dirty}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              disabled={saving || !dirty || !validation.valid}
            >
              <SaveIcon />
              {saving ? t("Saving...") : t("Save")}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}
