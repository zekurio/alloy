import {
  type AdminRuntimeConfig,
  type RenditionTierConfig,
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
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
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon, SaveIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { TranscodingLadder } from "@/components/routes/settings/admin-transcoding-ladder"
import {
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
import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import {
  adminKeys,
  adminTranscodingCapabilitiesQueryOptions,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { useActionFeedback } from "@/lib/use-action-feedback"

export function TranscodingSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.transcoding
  const [form, setForm] = useState<TranscodingForm>(() => formFromConfig(saved))
  const [saving, setSaving] = useState(false)
  const [redetecting, setRedetecting] = useState(false)
  const saveFeedback = useActionFeedback()
  const detectionFeedback = useActionFeedback()
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

  async function save() {
    if (saving || !dirty) return
    if (!validation.valid) {
      throw new Error(
        validation.message ?? t("Fix the invalid settings before saving."),
      )
    }
    setSaving(true)
    try {
      const updated = await api.admin.updateTranscodingConfig({
        videoCodec: form.videoCodec,
        hardwareAcceleration: form.hardwareAcceleration,
        vaapiDevice: form.vaapiDevice.trim(),
        quality: form.quality,
        audioBitrateKbps: form.audioBitrateKbps,
        tiers: form.tiers.map((tier) => {
          const config: RenditionTierConfig = {
            height: tier.height,
            maxFps: tier.maxFps,
            maxrateKbps: tier.maxrateKbps,
          }
          if (tier.codec) config.codec = tier.codec
          if (tier.og) config.og = true
          return config
        }),
      })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    saveFeedback.reset()
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
    } finally {
      setRedetecting(false)
    }
  }

  const inSettingsDialog = useSettingsSaveBar({
    dirty,
    saving,
    valid: validation.valid,
    save,
    discard,
  })

  return (
    <Section>
      <SectionContent className="py-0">
        <SettingsSections>
          <SettingsSubsection
            id="codec"
            title={t("Codec & encoding")}
            description={
              capabilitiesQuery.isLoading
                ? t("Detecting encoders...")
                : (capabilities?.version ?? t("ffmpeg not detected"))
            }
            action={
              <div className="flex min-w-0 items-center gap-2">
                {capabilities?.version ? (
                  <Badge
                    variant={capabilities.jellyfin ? "accent" : "default"}
                    size="text"
                  >
                    {ffmpegBadgeLabel(capabilities)}
                  </Badge>
                ) : null}
                <FeedbackButton
                  type="button"
                  variant="outline"
                  size="sm"
                  state={detectionFeedback.feedback.state}
                  pendingLabel={t("Detecting...")}
                  successLabel={t("Detected")}
                  errorLabel={
                    detectionFeedback.feedback.state === "error"
                      ? detectionFeedback.feedback.message
                      : t("Try again")
                  }
                  onClick={() =>
                    void detectionFeedback.run(
                      reDetect,
                      t("Couldn't detect encoders"),
                    )
                  }
                  disabled={redetecting || capabilitiesQuery.isLoading}
                  className="shrink-0"
                >
                  <RefreshCwIcon />
                  {t("Re-detect")}
                </FeedbackButton>
              </div>
            }
          >
            <SettingRows>
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
                    if (codec)
                      setForm((prev) => ({ ...prev, videoCodec: codec }))
                  }}
                >
                  <SelectTrigger
                    id="transcoding-codec"
                    size="sm"
                    className="w-48"
                  >
                    <SelectValue>
                      {VIDEO_CODEC_LABELS[form.videoCodec]}
                    </SelectValue>
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

              <SettingRow
                title={t("Hardware acceleration")}
                description={t(
                  "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.",
                )}
                htmlFor="transcoding-hwaccel"
                align="start"
                footer={
                  <HardwareAccelerationNote probe={selectedProbe} form={form} />
                }
              >
                <Select
                  value={form.hardwareAcceleration}
                  onValueChange={(value) => {
                    const accel = HARDWARE_ACCELERATIONS.find(
                      (option) => option === value,
                    )
                    if (accel) {
                      setForm((prev) => ({
                        ...prev,
                        hardwareAcceleration: accel,
                      }))
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
            </SettingRows>
          </SettingsSubsection>

          <SettingsSubsection id="audio" title={t("Audio")}>
            <SettingRows>
              <SettingRow
                title={t("Audio bitrate")}
                description={t(
                  "Stereo AAC bitrate applied to every rendition.",
                )}
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
                  <SelectTrigger
                    id="transcoding-audio"
                    size="sm"
                    className="w-48"
                  >
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
            </SettingRows>
          </SettingsSubsection>

          <TranscodingLadder
            form={form}
            validation={validation}
            setForm={setForm}
          />

          <p className="text-foreground-dim text-xs">
            {t(
              "Changes apply to new uploads. Existing clips re-encode in the background and keep playing their current renditions until replacements are ready.",
            )}
          </p>
        </SettingsSections>
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
            <FeedbackButton
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              state={saveFeedback.feedback.state}
              pendingLabel={t("Saving...")}
              successLabel={t("Saved")}
              errorLabel={
                saveFeedback.feedback.state === "error"
                  ? saveFeedback.feedback.message
                  : t("Try again")
              }
              onClick={() =>
                void saveFeedback.run(
                  save,
                  t("Couldn't save transcoding settings"),
                )
              }
              disabled={saving || !dirty || !validation.valid}
            >
              <SaveIcon />
              {t("Save")}
            </FeedbackButton>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}

function HardwareAccelerationNote({
  probe,
  form,
}: {
  probe: ReturnType<typeof findProbe> | null
  form: TranscodingForm
}) {
  if (!probe || probe.status === "ok") return null

  return (
    <Callout tone="destructive" className="text-xs">
      <TriangleAlertIcon />
      {probe.status === "missing"
        ? t(
            "This ffmpeg build has no {backend} encoder for {codec}. Pick another backend or install jellyfin-ffmpeg.",
            {
              backend: HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
              codec: VIDEO_CODEC_LABELS[form.videoCodec],
            },
          )
        : t(
            "The {backend} encoder for {codec} failed its test on this server. Pick another backend or check the GPU drivers.",
            {
              backend: HARDWARE_ACCELERATION_LABELS[form.hardwareAcceleration],
              codec: VIDEO_CODEC_LABELS[form.videoCodec],
            },
          )}
      {probe.error ? (
        <span className="text-foreground-muted text-2xs mt-1 block font-mono break-words">
          {probe.error}
        </span>
      ) : null}
    </Callout>
  )
}
