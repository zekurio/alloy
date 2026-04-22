import * as React from "react"
import { useForm } from "@tanstack/react-form"
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { toast } from "@workspace/ui/components/sonner"

import { AccountCreationFields } from "@/components/routes/auth/account-creation-fields"
import { authClient } from "@/lib/auth-client"
import { fetchAuthConfig } from "@/lib/auth-config"
import { AuthSubmitButton } from "@/components/routes/auth/auth-form-fields"
import { invalidateAuthConfig } from "@/lib/session-suspense"

/**
 * First-admin bootstrap — the only public sign-up surface. The server's
 * user-create hook is the real guard; this redirect is UX.
 */
export const Route = createFileRoute("/(auth)/setup")({
  loader: async () => {
    const config = await fetchAuthConfig()
    if (!config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    return config
  },
  component: SetupPage,
})

type SetupFormState = {
  username: string
  email: string
  password: string
}

function useSetupSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (form: SetupFormState) => {
      try {
        const { error: err } = await authClient.signUp.email({
          name: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        })
        if (err) {
          toast.error("Couldn't create the admin account", {
            description: err.message ?? "Please review the form and try again.",
          })
          return
        }
        toast.success("Admin account ready", {
          description: "Welcome — you can configure OAuth from here.",
        })
        invalidateAuthConfig()
        await navigate({ to: "/admin-settings" })
        await router.invalidate()
      } catch (cause) {
        toast.error("Unexpected error", {
          description:
            cause instanceof Error
              ? cause.message
              : "Something went wrong. Please try again.",
        })
      }
    },
    [navigate, router]
  )
}

function SetupForm({ onSubmit }: { onSubmit: (form: SetupFormState) => void }) {
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
      password: "",
    } as SetupFormState,
    onSubmit: async ({ value }) => {
      await onSubmit(value)
    },
  })
  const [showPassword, setShowPassword] = React.useState(false)
  const submissionAttempts = form.state.submissionAttempts
  const isSubmitting = form.state.isSubmitting

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-5"
    >
      <AccountCreationFields
        Field={form.Field}
        disabled={isSubmitting}
        showPassword={showPassword}
        submissionAttempts={submissionAttempts}
        togglePassword={() => setShowPassword((value) => !value)}
      />

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <AuthSubmitButton
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            pendingLabel="Creating account…"
          >
            <>
              Create admin account
              <ArrowRightIcon />
            </>
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}

function SetupPage() {
  const submit = useSetupSubmit()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AlloyLogo showText size={32} />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Create the admin account
            </h1>
            <p className="text-sm text-foreground-muted">
              You are the first user, create your admin account. This allows you
              to configure OAuth providers, enable sign-up and seed new users.
            </p>
          </div>
        </div>

        <SetupForm onSubmit={submit} />
      </div>
    </div>
  )
}
