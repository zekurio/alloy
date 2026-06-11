import { type AdminRuntimeConfig } from "@alloy/api"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
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
  LinkIcon,
  UserKeyIcon,
} from "lucide-react"
import * as React from "react"

import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { isDevSetupForced } from "@/lib/flags"
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
      !isDevSetupForced()
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

const PasskeySignUpForm = React.lazy(() =>
  import("@/components/routes/sign-up/passkey-sign-up-form").then((m) => ({
    default: m.PasskeySignUpForm,
  })),
)

function SetupPage() {
  return <SetupPageInner />
}

function SetupPageInner() {
  const { config } = Route.useLoaderData()
  const mode = config.adminAccountRequired ? "account" : "onboarding"

  return (
    <div className="bg-background text-foreground relative min-h-screen w-full">
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
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          Create the admin account
        </h2>
        <p className="text-foreground-muted text-sm">
          Since you are the first user, this account is assigned the admin role.
          After the passkey is created, you can finish the instance setup.
        </p>
      </div>

      <React.Suspense fallback={null}>
        <PasskeySignUpForm
          redirectTo="/setup"
          successMessage="Admin account ready"
        />
      </React.Suspense>
    </div>
  )
}

const SETUP_STEPS = [
  {
    icon: UserKeyIcon,
    label: "OIDC",
    description: "Configure an optional OIDC/OAuth provider for sign-in.",
    formId: "setup-oidc",
  },
  {
    icon: LinkIcon,
    label: "SteamGridDB",
    description: "Game artwork and metadata from SteamGridDB.",
    formId: "setup-integrations",
  },
] as const

type SetupStep = 0 | 1

const SETUP_LAST_STEP: SetupStep = 1

function AdminSetupSteps() {
  const setup = useAdminSetupSteps()

  if (setup.loadError) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive w-full rounded-md border p-3 text-sm">
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
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? errorMessage(configQuery.error, "Couldn't load setup")
    : null

  async function completeSetup() {
    try {
      await api.admin.updateRuntimeConfig({ setupComplete: true })
      invalidateAuthConfig()
      toast.success("Setup complete")
      void navigate({ to: "/" })
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't complete setup"))
    }
  }

  function advanceStep(savedStep: SetupStep) {
    setStep((currentStep) => {
      if (currentStep !== savedStep) return currentStep
      if (currentStep < SETUP_LAST_STEP) return (currentStep + 1) as SetupStep
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
  const isLastStep = step === SETUP_LAST_STEP

  function handleNext() {
    const formEl = document.getElementById(
      SETUP_STEPS[step].formId,
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
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          Finish instance setup
        </h2>
        <p className="text-foreground-muted text-sm">
          {currentStep.description}
        </p>
      </div>

      <StepIndicator currentStep={step} stepDone={stepDone} />

      <div className="flex flex-col gap-5">
        {step === 0 && (
          <OAuthProviderCard config={config} onChange={setConfig} hideHeader />
        )}
        {step === 1 && (
          <IntegrationsConfigCard
            integrations={config.integrations}
            onChange={(next) => setConfig(next)}
            onSaved={() => advanceStep(1)}
            formId="setup-integrations"
            hideActions
            hideHeader
            toastOnSuccess={false}
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

function getStepDone(config: AdminRuntimeConfig): [boolean, boolean] {
  return [
    // OIDC is optional; it is done once a provider is configured.
    config.oauthProviders.length > 0,
    // SteamGridDB is done once a key is configured.
    config.integrations.steamgriddbApiKeySet,
  ]
}

function StepIndicator({
  currentStep,
  stepDone,
}: {
  currentStep: SetupStep
  stepDone: [boolean, boolean]
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
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
              className={`size-4 ${
                isCurrent ? "text-accent" : "text-foreground-muted"
              }`}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {isDone ? (
              <CheckCircle2Icon className="text-success size-4" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
