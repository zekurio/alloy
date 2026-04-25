import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { AtSignIcon, LockIcon } from "lucide-react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { toast } from "@workspace/ui/lib/toast"

import { authClient } from "@/lib/auth-client"
import {
  AuthSubmitButton,
  FormInputField,
  PasswordInputField,
} from "../auth/auth-form-fields"
import { validatePassword, validateRequiredString } from "@/lib/form-validators"

type LoginCredentials = {
  identifier: string
  password: string
  rememberMe: boolean
}

type FieldMetaState = {
  errors: Array<unknown>
  isTouched: boolean
  isValid: boolean
}

type StringFieldController = {
  handleBlur: () => void
  handleChange: (value: string) => void
  name: string
  state: {
    meta: FieldMetaState
    value: string
  }
}

type BooleanFieldController = {
  handleChange: (value: boolean) => void
  state: {
    value: boolean
  }
}

function getFieldValidationState(
  meta: FieldMetaState,
  submissionAttempts: number
) {
  const showError = meta.isTouched || submissionAttempts > 0

  return {
    errors: showError ? meta.errors : undefined,
    invalid: showError && !meta.isValid,
  }
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
          toast.error("Couldn't sign in")
          return
        }
        await router.invalidate()
        await navigate({ to: "/" })
      } catch {
        toast.error("Unexpected sign-in error")
      }
    },
    [navigate, router]
  )
}

function LoginIdentifierField({
  field,
  submissionAttempts,
}: {
  field: StringFieldController
  submissionAttempts: number
}) {
  const { errors, invalid } = getFieldValidationState(
    field.state.meta,
    submissionAttempts
  )

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
      errors={errors}
      required
    />
  )
}

function LoginPasswordField({
  disabled,
  field,
  showPassword,
  submissionAttempts,
  togglePassword,
}: {
  disabled: boolean
  field: StringFieldController
  showPassword: boolean
  submissionAttempts: number
  togglePassword: () => void
}) {
  const { errors, invalid } = getFieldValidationState(
    field.state.meta,
    submissionAttempts
  )

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
      errors={errors}
      disabled={disabled}
      showPassword={showPassword}
      togglePassword={togglePassword}
      required
    />
  )
}

function RememberMeField({
  disabled,
  field,
}: {
  disabled: boolean
  field: BooleanFieldController
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox
        id="remember-me"
        checked={field.state.value}
        onCheckedChange={(value) => field.handleChange(value === true)}
        disabled={disabled}
      />
      <Label
        htmlFor="remember-me"
        className="cursor-pointer text-sm font-normal text-foreground-muted"
      >
        Keep me signed in
      </Label>
    </div>
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
      <form.Field
        name="identifier"
        validators={{
          onChange: ({ value }) =>
            validateRequiredString(value, "Email or username"),
        }}
      >
        {(field) => (
          <LoginIdentifierField
            field={field}
            submissionAttempts={submissionAttempts}
          />
        )}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) => validatePassword(value, 1),
        }}
      >
        {(field) => (
          <LoginPasswordField
            disabled={isSubmitting}
            field={field}
            showPassword={showPassword}
            submissionAttempts={submissionAttempts}
            togglePassword={() => setShowPassword((value) => !value)}
          />
        )}
      </form.Field>

      <form.Field name="rememberMe">
        {(field) => <RememberMeField disabled={isSubmitting} field={field} />}
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
