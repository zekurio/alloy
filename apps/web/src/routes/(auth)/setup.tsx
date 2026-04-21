import * as React from "react"
import { useForm } from "@tanstack/react-form"
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { ArrowRightIcon, LockIcon, MailIcon, UserIcon } from "lucide-react"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../lib/auth-client"
import { fetchAuthConfig } from "../../lib/auth-config"
import {
  AuthSubmitButton,
  FormInputField,
  PasswordInputField,
} from "../../components/routes/auth/auth-form-fields"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../../lib/form-validators"
import { invalidateAuthConfig } from "../../lib/session-suspense"

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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-5"
    >
      <form.Field
        name="username"
        validators={{
          onChange: ({ value }) => validateUsername(value.trim()),
        }}
      >
        {(field) => {
          const showError =
            field.state.meta.isTouched || form.state.submissionAttempts > 0
          const invalid = showError && !field.state.meta.isValid

          return (
            <FormInputField
              id={field.name}
              label="Username"
              icon={<UserIcon />}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
              placeholder="alice"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(value) => field.handleChange(value.toLowerCase())}
              invalid={invalid}
              errors={showError ? field.state.meta.errors : undefined}
              description="Lowercase letters, numbers, underscores and hyphens."
              disabled={form.state.isSubmitting}
              required
            />
          )
        }}
      </form.Field>

      <form.Field
        name="email"
        validators={{
          onChange: ({ value }) => validateEmail(value),
        }}
      >
        {(field) => {
          const showError =
            field.state.meta.isTouched || form.state.submissionAttempts > 0
          const invalid = showError && !field.state.meta.isValid

          return (
            <FormInputField
              id={field.name}
              label="Email"
              icon={<MailIcon />}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              invalid={invalid}
              errors={showError ? field.state.meta.errors : undefined}
              disabled={form.state.isSubmitting}
              required
            />
          )
        }}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) => validatePassword(value),
        }}
      >
        {(field) => {
          const showError =
            field.state.meta.isTouched || form.state.submissionAttempts > 0
          const invalid = showError && !field.state.meta.isValid

          return (
            <PasswordInputField
              id={field.name}
              label="Password"
              icon={<LockIcon />}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              invalid={invalid}
              errors={showError ? field.state.meta.errors : undefined}
              description="Use at least 8 characters."
              disabled={form.state.isSubmitting}
              showPassword={showPassword}
              togglePassword={() => setShowPassword((value) => !value)}
              required
            />
          )
        }}
      </form.Field>

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
