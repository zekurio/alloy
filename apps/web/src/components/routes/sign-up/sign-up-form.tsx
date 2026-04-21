import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowRightIcon, LockIcon, MailIcon, UserIcon } from "lucide-react"

import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"
import {
  AuthSubmitButton,
  FormInputField,
  PasswordInputField,
} from "../auth/auth-form-fields"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../../../lib/form-validators"

type SignUpFormState = {
  username: string
  email: string
  password: string
}

function useSignUpSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (form: SignUpFormState) => {
      try {
        const { error: err } = await authClient.signUp.email({
          name: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        })
        if (err) {
          toast.error("Couldn't create your account", {
            description: err.message ?? "Please review the form and try again.",
          })
          return
        }
        await router.invalidate()
        await navigate({ to: "/" })
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

export function SignUpForm() {
  const submit = useSignUpSubmit()
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
      password: "",
    } as SignUpFormState,
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
              Create account
              <ArrowRightIcon />
            </>
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
