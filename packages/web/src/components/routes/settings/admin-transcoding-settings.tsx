import {
  type AdminRuntimeConfig,
  type RenditionTierConfig,
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Input } from "@alloy/ui/components/input"
import { Section, SectionContent } from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { useForm, useStore } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useMemo } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { TranscodingLadder } from "@/components/routes/settings/admin-transcoding-ladder"
import {
  ffmpegBadgeLabel,
  findProbe,
  formFromConfig,
  formsEqual,
  sortTiers,
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
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

export function TranscodingSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.transcoding
  const saveTranscoding = useAdminConfigMutation(
    api.admin.updateTranscodingConfig,
  )
  const saving = saveTranscoding.isPending
  const detectionFeedback = useActionFeedback()
  const queryClient = useQueryClient()
  const capabilitiesQuery = useQuery(adminTranscodingCapabilitiesQueryOptions())
  const capabilities = capabilitiesQuery.data ?? null

  // The saved config is the source of truth: the form adopts a new one while
  // untouched, and a save resets it to what the server normalized/clamped.
  const form = useForm({
    defaultValues: formFromConfig(saved),
    onSubmit: async ({ value, formApi }) => {
      const result = validateForm(value, capabilities)
      if (!result.valid) {
        throw new Error(
          result.message ?? t("Fix the invalid settings before saving."),
        )
      }
      const updated = await saveTranscoding.mutateAsync({
        videoCodec: value.videoCodec,
        hardwareAcceleration: value.hardwareAcceleration,
        vaapiDevice: value.vaapiDevice.trim(),
        quality: value.quality,
        audioBitrateKbps: value.audioBitrateKbps,
        // Rows stay put while being edited; they settle into order on save.
        tiers: sortTiers(value.tiers).map((tier) => {
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
      formApi.reset(formFromConfig(updated.transcoding), {
        keepDefaultValues: true,
      })
    },
  })
  const values = useStore(form.store, (state) => state.values)

  const validation = useMemo(
    () => validateForm(values, capabilities),
    [values, capabilities],
  )
  const dirty = useMemo(() => !formsEqual(values, saved), [values, saved])
  const selectedProbe =
    values.hardwareAcceleration === "none" || !capabilities
      ? null
      : findProbe(capabilities, values.videoCodec, values.hardwareAcceleration)

  async function reDetect() {
    const next = await api.admin.fetchTranscodingCapabilities({
      refresh: true,
    })
    queryClient.setQueryData(adminKeys.transcodingCapabilities(), next)
  }

  useSettingsSaveBar(form, { dirty, saving, valid: validation.valid })

  return (
    <Section>
      <SectionContent className="py-0">
        <SettingsSections>
          <SettingsSubsection
            id="codec"
            title={t("Codec & encoding")}
            description={
              capabilitiesQuery.isLoading ? (
                t("Detecting encoders...")
              ) : capabilitiesQuery.isError && !capabilities ? (
                // A failed probe says nothing about ffmpeg; Re-detect retries.
                <span role="alert" className="text-destructive">
                  {errorMessage(
                    capabilitiesQuery.error,
                    t("Couldn't detect encoders"),
                  )}
                </span>
              ) : (
                (capabilities?.version ?? t("ffmpeg not detected"))
              )
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
                  variant="secondary"
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
                  disabled={capabilitiesQuery.isLoading}
                  className="shrink-0"
                >
                  <RefreshCwIcon />
                  {t("Re-detect")}
                </FeedbackButton>
              </div>
            }
          >
            <SettingRows>
              <TranscodingChoiceSetting
                title={t("Video codec")}
                description={t(
                  "Default codec for every rendition. Individual tiers in the ladder can override it.",
                )}
                id="transcoding-codec"
                value={values.videoCodec}
                options={TRANSCODE_VIDEO_CODECS}
                getOptionLabel={(codec) => VIDEO_CODEC_LABELS[codec]}
                onChange={(videoCodec) =>
                  form.setFieldValue("videoCodec", videoCodec)
                }
              />

              <SettingRow
                title={t("Hardware acceleration")}
                description={t(
                  "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.",
                )}
                htmlFor="transcoding-hwaccel"
                align="start"
                stack
                footer={
                  <HardwareAccelerationNote
                    probe={selectedProbe}
                    form={values}
                  />
                }
              >
                <Select
                  value={values.hardwareAcceleration}
                  onValueChange={(value) => {
                    const accel = HARDWARE_ACCELERATIONS.find(
                      (option) => option === value,
                    )
                    if (accel) form.setFieldValue("hardwareAcceleration", accel)
                  }}
                >
                  <SelectTrigger
                    id="transcoding-hwaccel"
                    size="sm"
                    className="w-full @lg:w-56"
                  >
                    <SelectValue>
                      {
                        HARDWARE_ACCELERATION_LABELS[
                          values.hardwareAcceleration
                        ]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {HARDWARE_ACCELERATIONS.map((accel) => {
                      const probe =
                        accel === "none" || !capabilities
                          ? null
                          : findProbe(capabilities, values.videoCodec, accel)
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

              {values.hardwareAcceleration === "vaapi" ? (
                <SettingRow
                  title={t("VA-API device")}
                  description={t(
                    "Render node passed to ffmpeg for VA-API encoding.",
                  )}
                  htmlFor="transcoding-vaapi-device"
                  align="start"
                  stack
                >
                  <div className="flex w-full flex-col gap-1.5 @lg:w-56">
                    <Input
                      id="transcoding-vaapi-device"
                      value={values.vaapiDevice}
                      onChange={(event) =>
                        form.setFieldValue("vaapiDevice", event.target.value)
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
              <TranscodingChoiceSetting
                title={t("Audio bitrate")}
                description={t(
                  "Stereo AAC bitrate applied to every rendition.",
                )}
                id="transcoding-audio"
                value={values.audioBitrateKbps}
                options={AUDIO_BITRATES}
                getOptionLabel={(kbps) => t("{kbps} kbps", { kbps })}
                onChange={(audioBitrateKbps) =>
                  form.setFieldValue("audioBitrateKbps", audioBitrateKbps)
                }
              />
            </SettingRows>
          </SettingsSubsection>

          <TranscodingLadder
            values={values}
            validation={validation}
            setTiers={(update) => form.setFieldValue("tiers", update)}
          />

          <p className="text-foreground-dim text-xs">
            {t(
              "Changes apply to new uploads. Existing clips re-encode in the background and keep playing their current renditions until replacements are ready.",
            )}
          </p>
        </SettingsSections>
      </SectionContent>
    </Section>
  )
}

function TranscodingChoiceSetting<T extends string | number>({
  title,
  description,
  id,
  value,
  options,
  getOptionLabel,
  onChange,
}: {
  title: string
  description: string
  id: string
  value: T
  options: readonly T[]
  getOptionLabel: (option: T) => string
  onChange: (value: T) => void
}) {
  return (
    <SettingRow
      title={title}
      description={description}
      htmlFor={id}
      align="start"
      stack
    >
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const option = options.find((candidate) => String(candidate) === next)
          if (option !== undefined) onChange(option)
        }}
      >
        <SelectTrigger id={id} size="sm" className="w-full @lg:w-48">
          <SelectValue>{getOptionLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={String(option)} value={String(option)}>
              {getOptionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
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
