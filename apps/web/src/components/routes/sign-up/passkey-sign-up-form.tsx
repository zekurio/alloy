import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { toast } from "@workspace/ui/lib/toast"
import { ArrowRightIcon, KeyRoundIcon, MailIcon, UserIcon } from "lucide-react"
import * as React from "react"

import { authClient } from "@/lib/auth-client"
import {
  completeAuthSessionFlow,
  toastAuthAttemptFailure,
} from "@/lib/auth-flow"
import { validateEmail, validateUsername } from "@/lib/form-validators"
import { invalidateAuthConfig } from "@/lib/session-suspense"

import { AuthSubmitButton, FormInputField } from "../auth/auth-form-fields"

type PasskeySignUpFormState = {
  username: string
  email: string
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

type PasskeySignUpFormProps = {
  redirectTo?: "/" | "/setup" | "/settings"
  successMessage?: string
}

function usePasskeySignUpSubmit({
  redirectTo = "/",
  successMessage,
}: PasskeySignUpFormProps) {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (form: PasskeySignUpFormState) => {
      try {
        const { error } = await authClient.passkey.signUp({
          email: form.email.trim(),
          username: form.username.trim(),
        })
        if (error) {
          toastAuthAttemptFailure(
            "passkey sign-up",
            "Couldn't create your passkey account",
            error,
          )
          return
        }
        if (successMessage) toast.success(successMessage)
        invalidateAuthConfig()
        await completeAuthSessionFlow({
          invalidateRouter: () => router.invalidate(),
          navigate: () => navigate({ to: redirectTo }),
        })
      } catch (cause) {
        toastAuthAttemptFailure(
          "passkey sign-up",
          "Couldn't finish passkey account setup",
          cause,
        )
      }
    },
    [navigate, redirectTo, router, successMessage],
  )
}

function getFieldValidationState(
  meta: FieldMetaState,
  submissionAttempts: number,
) {
  const showError = meta.isTouched || submissionAttempts > 0
  return {
    errors: showError ? meta.errors : undefined,
    invalid: showError && !meta.isValid,
  }
}

function PasskeyAccountField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  description,
  disabled,
  errors,
  field,
  icon,
  invalid,
  label,
  onChange,
  placeholder,
  spellCheck,
  type,
}: {
  autoCapitalize?: React.ComponentProps<typeof FormInputField>["autoCapitalize"]
  autoComplete?: React.ComponentProps<typeof FormInputField>["autoComplete"]
  autoCorrect?: React.ComponentProps<typeof FormInputField>["autoCorrect"]
  description?: React.ReactNode
  disabled: boolean
  errors?: Array<unknown>
  field: StringFieldController
  icon: React.ReactNode
  invalid: boolean
  label: string
  onChange?: (value: string) => void
  placeholder: string
  spellCheck?: boolean
  type?: React.ComponentProps<typeof FormInputField>["type"]
}) {
  return (
    <FormInputField
      id={field.name}
      label={label}
      icon={icon}
      type={type}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      placeholder={placeholder}
      value={field.state.value}
      onBlur={field.handleBlur}
      onChange={onChange ?? field.handleChange}
      invalid={invalid}
      errors={errors}
      description={description}
      disabled={disabled}
      required
    />
  )
}

function UsernameField(props: {
  disabled: boolean
  field: StringFieldController
  submissionAttempts: number
}) {
  const { errors, invalid } = getFieldValidationState(
    props.field.state.meta,
    props.submissionAttempts,
  )

  return (
    <PasskeyAccountField
      label="Username"
      icon={<UserIcon />}
      autoCapitalize="none"
      autoComplete="username"
      autoCorrect="off"
      spellCheck={false}
      placeholder="Alice"
      field={props.field}
      invalid={invalid}
      errors={errors}
      disabled={props.disabled}
    />
  )
}

function EmailField(props: {
  disabled: boolean
  field: StringFieldController
  submissionAttempts: number
}) {
  const { errors, invalid } = getFieldValidationState(
    props.field.state.meta,
    props.submissionAttempts,
  )

  return (
    <PasskeyAccountField
      label="Email"
      icon={<MailIcon />}
      type="email"
      autoComplete="email"
      placeholder="you@example.com"
      field={props.field}
      invalid={invalid}
      errors={errors}
      disabled={props.disabled}
    />
  )
}

function SubmitButton() {
  return (
    <>
      <KeyRoundIcon className="size-4" />
      Create account with passkey
      <ArrowRightIcon />
    </>
  )
}

export function PasskeySignUpForm(props: PasskeySignUpFormProps) {
  const submit = usePasskeySignUpSubmit(props)
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
    } as PasskeySignUpFormState,
    onSubmit: async ({ value }) => {
      await submit(value)
    },
  })
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
        name="username"
        validators={{
          onChange: ({ value }) => validateUsername(value),
        }}
      >
        {(field) => (
          <UsernameField
            disabled={isSubmitting}
            field={field}
            submissionAttempts={submissionAttempts}
          />
        )}
      </form.Field>

      <form.Field
        name="email"
        validators={{
          onChange: ({ value }) => validateEmail(value),
        }}
      >
        {(field) => (
          <EmailField
            disabled={isSubmitting}
            field={field}
            submissionAttempts={submissionAttempts}
          />
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <AuthSubmitButton
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            onFocus={authClient.passkey.preload}
            onPointerEnter={authClient.passkey.preload}
            pendingLabel="Waiting for authenticator…"
          >
            <SubmitButton />
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
