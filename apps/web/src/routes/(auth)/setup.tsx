import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FilmIcon,
  InfoIcon,
  LinkIcon,
} from "lucide-react"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"
import type {
  AdminEncoderConfig,
  AdminEncoderVariant,
  AdminRuntimeConfig,
} from "@workspace/api"

import { LoginArtwork } from "@/components/auth/login-artwork"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { StorageConfigCard } from "@/components/routes/admin-settings/storage-config-card"
import { PasskeySignUpForm } from "@/components/routes/sign-up/passkey-sign-up-form"
import { api } from "@/lib/api"
import { fetchPublicClips } from "@/lib/public-clips"
import type { PublicClip } from "@/lib/public-clips"
import { loadAuthConfig, loadSession } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    const session = config.setupRequired
      ? null
      : (context.session ?? (await loadSession()))
    const role = (session?.user as { role?: string } | undefined)?.role
    if (!config.setupRequired && !session) {
      throw redirect({ to: "/login" })
    }
    if (!config.setupRequired && role !== "admin") throw redirect({ to: "/" })
    const clips = fetchPublicClips()
    return { config, clips, session }
  },
  component: SetupPage,
})

function SetupPage() {
  const { clips } = Route.useLoaderData()
  return (
    <React.Suspense fallback={<SetupPageInner clips={[]} />}>
      <SetupPageLoaded clips={clips} />
    </React.Suspense>
  )
}

function SetupPageLoaded({
  clips,
}: {
  clips: ReturnType<typeof fetchPublicClips>
}) {
  const resolvedClips = React.use(clips)
  return <SetupPageInner clips={resolvedClips} />
}

function SetupPageInner({ clips }: { clips: PublicClip[] }) {
  const { config } = Route.useLoaderData()
  const mode = config.setupRequired ? "account" : "onboarding"

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <div className="absolute inset-0 overflow-hidden">
        <LoginArtwork clips={clips} />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-[1fr_minmax(560px,0.78fr)]">
        <div className="hidden lg:block" />

        <div className="relative flex min-h-screen flex-col bg-background/85 px-6 py-8 backdrop-blur-md sm:px-10 lg:bg-background lg:backdrop-blur-none">
          <header className="flex items-center">
            <Link to="/" className="inline-flex items-center">
              <AlloyLogo showText size={36} />
            </Link>
          </header>

          <div className="flex flex-1 items-center py-8">
            {mode === "account" ? <AdminAccountStep /> : <AdminSetupSteps />}
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminAccountStep() {
  return (
    <div className="mx-auto w-full max-w-sm lg:mx-0">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Create the admin account
        </h2>
        <p className="text-sm text-foreground-muted">
          Since you are the first user, this account is assigned the admin role.
          After the passkey is created, you can finish the instance setup.
        </p>
      </div>

      <PasskeySignUpForm
        redirectTo="/setup"
        successMessage="Admin account ready"
      />
    </div>
  )
}

const defaultEncoderVariant: AdminEncoderVariant = {
  name: "1080p HEVC",
  codec: "hevc",
  height: 1080,
  quality: 24,
  preset: "medium",
  audioBitrateKbps: 160,
  extraInputArgs: "",
  extraOutputArgs: "",
}

const SETUP_STEPS = [
  { icon: DatabaseIcon, label: "Storage", formId: "setup-storage" },
  { icon: FilmIcon, label: "Encoding", formId: "setup-encoder" },
  { icon: LinkIcon, label: "SteamGridDB", formId: "setup-integrations" },
] as const

type SetupStep = 0 | 1 | 2

function AdminSetupSteps() {
  const navigate = useNavigate()
  const [step, setStep] = React.useState<SetupStep>(0)
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)
  const configQuery = useQuery({
    queryKey: ["setup", "admin-runtime-config"],
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? configQuery.error instanceof Error
      ? configQuery.error.message
      : "Couldn't load setup"
    : null

  if (loadError) {
    return (
      <div className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  if (!config) return null

  const stepDone = getStepDone(config)
  const isLastStep = step === 2

  function advanceStep() {
    if (step < 2) {
      setStep((step + 1) as SetupStep)
    } else {
      void navigate({ to: "/" })
    }
  }

  function handleNext() {
    const formEl = document.getElementById(
      SETUP_STEPS[step].formId
    ) as HTMLFormElement | null
    if (formEl) {
      formEl.requestSubmit()
    } else {
      advanceStep()
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:mx-0">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Finish instance setup
        </h2>
        <p className="text-sm text-foreground-muted">
          {step === 0 && "Configure where clip uploads are stored."}
          {step === 1 && "Set up video encoding for playback variants."}
          {step === 2 && "Connect SteamGridDB for game artwork metadata."}
        </p>
      </div>

      <StepIndicator currentStep={step} stepDone={stepDone} />

      <div className="flex flex-col gap-5">
        {step === 0 && (
          <StorageConfigCard
            storage={config.storage}
            onChange={(next) => setConfig(next)}
            onSaved={advanceStep}
            formId="setup-storage"
            hideActions
          />
        )}
        {step === 1 && (
          <EncoderOnboardingCard
            config={config}
            onChange={(next) => setConfig(next)}
            encoderFormId="setup-encoder"
            hideEncoderActions
            onEncoderSaved={advanceStep}
          />
        )}
        {step === 2 && (
          <IntegrationsConfigCard
            integrations={config.integrations}
            onChange={(next) => setConfig(next)}
            onSaved={advanceStep}
            formId="setup-integrations"
            hideActions
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((step - 1) as SetupStep)}
            >
              <ArrowLeftIcon />
              Back
            </Button>
          )}
        </div>
        <Button type="button" variant="primary" onClick={handleNext}>
          {isLastStep ? "Complete setup" : "Next"}
          <ArrowRightIcon />
        </Button>
      </div>
    </div>
  )
}

function getStepDone(config: AdminRuntimeConfig): [boolean, boolean, boolean] {
  return [
    // Storage is considered done if it has a configured driver
    true,
    // Encoding is done when enabled with at least one variant
    config.encoder.enabled && config.encoder.variants.length > 0,
    // SteamGridDB is done when the key is set (redacted = "***")
    config.integrations.steamgriddbApiKey === "***",
  ]
}

function StepIndicator({
  currentStep,
  stepDone,
}: {
  currentStep: SetupStep
  stepDone: [boolean, boolean, boolean]
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {SETUP_STEPS.map((item, index) => {
        const isCurrent = index === currentStep
        const isDone = stepDone[index]

        return (
          <div
            key={item.label}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
              isCurrent
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface-raised text-foreground"
            }`}
          >
            <item.icon
              className={`size-4 ${isCurrent ? "text-accent" : "text-foreground-muted"}`}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {isDone ? (
              <CheckCircle2Icon className="size-4 text-success" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function EncoderOnboardingCard({
  config,
  onChange,
  encoderFormId,
  hideEncoderActions,
  onEncoderSaved,
}: {
  config: AdminRuntimeConfig
  onChange: (next: AdminRuntimeConfig) => void
  encoderFormId?: string
  hideEncoderActions?: boolean
  onEncoderSaved?: () => void
}) {
  const [pending, setPending] = React.useState(false)
  const capsQuery = useQuery({
    queryKey: ["admin", "encoder-capabilities"],
    queryFn: () => api.admin.fetchEncoderCapabilities(),
    staleTime: 5 * 60_000,
  })
  const caps = capsQuery.data
  const showSuggestion =
    !config.encoder.enabled || config.encoder.variants.length === 0

  async function applyDefaultProfile() {
    if (pending) return
    if (caps?.ffmpegOk && !caps.available.none.hevc) {
      toast.error("Detected ffmpeg does not report software HEVC support.")
      return
    }
    setPending(true)
    const nextEncoder: AdminEncoderConfig = {
      ...config.encoder,
      enabled: true,
      hwaccel: "none",
      keepSource: true,
      variants: [defaultEncoderVariant],
    }
    try {
      const next = await api.admin.updateEncoderConfig(nextEncoder)
      onChange(next)
      toast.success("Default encoder variant applied")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update encoder"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {showSuggestion && (
        <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent-soft px-4 py-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-accent" />
          <p className="min-w-0 text-sm text-foreground-muted">
            Not sure where to start?{" "}
            <button
              type="button"
              className="inline font-medium text-accent underline underline-offset-2 transition-colors hover:text-accent-hover disabled:opacity-50"
              onClick={applyDefaultProfile}
              disabled={pending}
            >
              {pending
                ? "Applying…"
                : "Apply the recommended 1080p HEVC profile"}
            </button>{" "}
            for software encoding that works out of the box.
          </p>
        </div>
      )}

      <EncoderConfigCard
        encoder={config.encoder}
        onChange={(next) => onChange(next)}
        formId={encoderFormId}
        hideActions={hideEncoderActions}
        onSaved={onEncoderSaved}
      />
    </div>
  )
}
