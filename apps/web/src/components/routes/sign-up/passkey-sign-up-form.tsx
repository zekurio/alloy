import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowRightIcon, KeyRoundIcon, MailIcon, UserIcon } from "lucide-react"

import { toast } from "@workspace/ui/lib/toast"

import { AuthSubmitButton, FormInputField } from "../auth/auth-form-fields"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { validateEmail, validateUsername } from "@/lib/form-validators"
import { addPasskeyWithLabel } from "@/lib/passkeys"
import { invalidateAuthConfig } from "@/lib/session-suspense"

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
  redirectTo?: "/" | "/user-settings"
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
        const { context } = await api.authConfig.createPasskeySignUp({
          email: form.email.trim(),
          username: form.username.trim().toLowerCase(),
        })
        const { error } = await addPasskeyWithLabel({
          context,
          label: `${form.username.trim()}'s passkey`,
          promptForLabel: true,
        })
        if (error) {
          toast.error("Couldn't create your passkey account")
          return
        }
        if (successMessage) toast.success(successMessage)
        invalidateAuthConfig()
        await authClient.getSession()
        await router.invalidate()
        await navigate({ to: redirectTo })
      } catch {
        toast.error("Unexpected error")
      }
    },
    [navigate, redirectTo, router, successMessage]
  )
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
    props.submissionAttempts
  )

  return (
    <PasskeyAccountField
      label="Username"
      icon={<UserIcon />}
      autoCapitalize="none"
      autoComplete="username"
      autoCorrect="off"
      spellCheck={false}
      placeholder="alice"
      field={props.field}
      onChange={(value) => props.field.handleChange(value.toLowerCase())}
      invalid={invalid}
      errors={errors}
      description="Lowercase letters, numbers, underscores and hyphens."
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
    props.submissionAttempts
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
          onChange: ({ value }) => validateUsername(value.trim()),
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
            pendingLabel="Waiting for authenticator…"
          >
            <SubmitButton />
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
