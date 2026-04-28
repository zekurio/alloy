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

import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { StorageConfigCard } from "@/components/routes/admin-settings/storage-config-card"
import { PasskeySignUpForm } from "@/components/routes/sign-up/passkey-sign-up-form"
import { api } from "@/lib/api"
import { devFlags } from "@/lib/flags"
import {
  invalidateAuthConfig,
  loadAuthConfig,
  loadSession,
} from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    const session = config.adminAccountRequired
      ? null
      : (context.session ?? (await loadSession()))
    const role = (session?.user as { role?: string } | undefined)?.role
    if (!config.adminAccountRequired && !session) {
      throw redirect({ to: "/login" })
    }
    if (
      !config.adminAccountRequired &&
      !config.setupRequired &&
      !devFlags.forceOnboarding
    ) {
      throw redirect({ to: "/" })
    }
    if (!config.adminAccountRequired && role !== "admin") {
      throw redirect({ to: "/" })
    }
    return { config, session }
  },
  component: SetupPage,
})

function SetupPage() {
  return <SetupPageInner />
}

function SetupPageInner() {
  const { config } = Route.useLoaderData()
  const mode = config.adminAccountRequired ? "account" : "onboarding"

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <main className="relative flex min-h-screen items-center justify-center px-6 py-24 sm:px-10">
        {mode === "account" ? <AdminAccountStep /> : <AdminSetupSteps />}
      </main>
    </div>
  )
}

function AdminAccountStep() {
  return (
    <div className="w-full max-w-sm">
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
  id: "1080p-hevc",
  name: "1080p HEVC",
  codec: "hevc",
  height: 1080,
  quality: 24,
  preset: "medium",
  audioBitrateKbps: 192,
  extraInputArgs: "",
  extraOutputArgs: "",
}

const SETUP_STEPS = [
  {
    icon: DatabaseIcon,
    label: "Storage",
    description: "Configure where clips and uploads are stored.",
    formId: "setup-storage",
  },
  {
    icon: FilmIcon,
    label: "Encoding",
    description: "Configure video encoding and hardware acceleration.",
    formId: "setup-encoder",
  },
  {
    icon: LinkIcon,
    label: "SteamGridDB",
    description: "Game artwork and metadata from SteamGridDB.",
    formId: "setup-integrations",
  },
] as const

type SetupStep = 0 | 1 | 2

function AdminSetupSteps() {
  const setup = useAdminSetupSteps()

  if (setup.loadError) {
    return (
      <div className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {setup.loadError}
      </div>
    )
  }

  if (!setup.config) return null

  return (
    <AdminSetupStepContent
      config={setup.config}
      step={setup.step}
      setStep={setup.setStep}
      setConfig={setup.setConfig}
      advanceStep={setup.advanceStep}
    />
  )
}

function useAdminSetupSteps() {
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

  async function completeSetup() {
    try {
      await api.admin.updateRuntimeConfig({ setupComplete: true })
      invalidateAuthConfig()
      toast.success("Setup complete")
      void navigate({ to: "/" })
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't complete setup"
      )
    }
  }

  function advanceStep(savedStep: SetupStep) {
    setStep((currentStep) => {
      if (currentStep !== savedStep) return currentStep
      if (currentStep < 2) return (currentStep + 1) as SetupStep
      queueMicrotask(() => void completeSetup())
      return currentStep
    })
  }

  return { advanceStep, config, loadError, setConfig, setStep, step }
}

function AdminSetupStepContent({
  config,
  step,
  setStep,
  setConfig,
  advanceStep,
}: {
  config: AdminRuntimeConfig
  step: SetupStep
  setStep: React.Dispatch<React.SetStateAction<SetupStep>>
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
  advanceStep: (savedStep: SetupStep) => void
}) {
  const stepDone = getStepDone(config)
  const isLastStep = step === 2

  function handleNext() {
    const formEl = document.getElementById(
      SETUP_STEPS[step].formId
    ) as HTMLFormElement | null
    if (formEl) {
      formEl.requestSubmit()
    } else {
      advanceStep(step)
    }
  }

  const currentStep = SETUP_STEPS[step]
  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Finish instance setup
        </h2>
        <p className="text-sm text-foreground-muted">
          {currentStep.description}
        </p>
      </div>

      <StepIndicator currentStep={step} stepDone={stepDone} />

      <div className="flex flex-col gap-5">
        {step === 0 && (
          <StorageConfigCard
            storage={config.storage}
            onChange={(next) => setConfig(next)}
            onSaved={() => advanceStep(0)}
            formId="setup-storage"
            hideActions
            hideHeader
          />
        )}
        {step === 1 && (
          <EncoderOnboardingCard
            config={config}
            onChange={(next) => setConfig(next)}
            encoderFormId="setup-encoder"
            hideEncoderActions
            hideEncoderHeader
            onEncoderSaved={() => advanceStep(1)}
          />
        )}
        {step === 2 && (
          <IntegrationsConfigCard
            integrations={config.integrations}
            onChange={(next) => setConfig(next)}
            onSaved={() => advanceStep(2)}
            formId="setup-integrations"
            hideActions
            hideHeader
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
    config.encoder.remuxEnabled ||
      (config.encoder.enabled && config.encoder.variants.length > 0),
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
  hideEncoderHeader,
  hideEncoderActions,
  onEncoderSaved,
}: {
  config: AdminRuntimeConfig
  onChange: (next: AdminRuntimeConfig) => void
  encoderFormId?: string
  hideEncoderHeader?: boolean
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
      remuxEnabled: true,
      hwaccel: "none",
      keepSource: true,
      defaultVariantId: defaultEncoderVariant.id,
      openGraphTarget: { type: "source" },
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
        hideHeader={hideEncoderHeader}
        hideActions={hideEncoderActions}
        onSaved={onEncoderSaved}
      />
    </div>
  )
}
