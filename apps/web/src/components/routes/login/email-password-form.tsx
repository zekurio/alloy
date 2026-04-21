import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { AtSignIcon, LockIcon } from "lucide-react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"
import {
  AuthSubmitButton,
  FormInputField,
  PasswordInputField,
} from "../auth/auth-form-fields"
import {
  validatePassword,
  validateRequiredString,
} from "../../../lib/form-validators"

type LoginCredentials = {
  identifier: string
  password: string
  rememberMe: boolean
}

function useEmailPasswordSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (creds: LoginCredentials) => {
      try {
        const identifier = creds.identifier.trim()
        const isEmail = identifier.includes("@")
        const { error: err } = isEmail
          ? await authClient.signIn.email({
              email: identifier,
              password: creds.password,
              rememberMe: creds.rememberMe,
            })
          : await authClient.signIn.username({
              username: identifier,
              password: creds.password,
              rememberMe: creds.rememberMe,
            })
        if (err) {
          toast.error("Couldn't sign in", {
            description: err.message ?? "Check your details and try again.",
          })
          return
        }
        await router.invalidate()
        await navigate({ to: "/" })
      } catch (cause) {
        toast.error("Unexpected sign-in error", {
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

export function EmailPasswordForm() {
  const submit = useEmailPasswordSubmit()
  const form = useForm({
    defaultValues: {
      identifier: "",
      password: "",
      rememberMe: true,
    } as LoginCredentials,
    onSubmit: async ({ value }) => {
      await submit(value)
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
        name="identifier"
        validators={{
          onChange: ({ value }) =>
            validateRequiredString(value, "Email or username"),
        }}
      >
        {(field) => {
          const showError =
            field.state.meta.isTouched || form.state.submissionAttempts > 0
          const invalid = showError && !field.state.meta.isValid

          return (
            <FormInputField
              id={field.name}
              label="Email or username"
              icon={<AtSignIcon />}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com or yourhandle"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              invalid={invalid}
              errors={showError ? field.state.meta.errors : undefined}
              required
            />
          )
        }}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) => validatePassword(value, 1),
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
              autoComplete="current-password"
              placeholder="••••••••"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              invalid={invalid}
              errors={showError ? field.state.meta.errors : undefined}
              disabled={form.state.isSubmitting}
              showPassword={showPassword}
              togglePassword={() => setShowPassword((value) => !value)}
              headerAction={
                <a
                  href="#"
                  className="text-sm text-foreground-muted underline-offset-4 hover:text-accent hover:underline"
                >
                  Forgot?
                </a>
              }
              required
            />
          )
        }}
      </form.Field>

      <form.Field name="rememberMe">
        {(field) => (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground-muted select-none">
            <Checkbox
              checked={field.state.value}
              onCheckedChange={(value) => field.handleChange(value === true)}
              disabled={form.state.isSubmitting}
            />
            Keep me signed in
          </label>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <AuthSubmitButton
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            pendingLabel="Signing in…"
          >
            Sign in
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
