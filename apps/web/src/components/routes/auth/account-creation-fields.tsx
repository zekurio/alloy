import * as React from "react"
import { LockIcon, MailIcon, UserIcon } from "lucide-react"

import {
  FormInputField,
  PasswordInputField,
  type AuthStringFieldController,
} from "./auth-form-fields"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/form-validators"

type AccountCreationFieldProps = {
  disabled: boolean
  field: AuthStringFieldController
  submissionAttempts: number
}

type PasswordAccountCreationFieldProps = AccountCreationFieldProps & {
  showPassword: boolean
  togglePassword: () => void
}

type AccountCreationFieldComponent = React.ComponentType<{
  children: (field: AuthStringFieldController) => React.ReactNode
  name: "email" | "password" | "username"
  validators: {
    onChange: ({ value }: { value: string }) => unknown
  }
}>

function getFieldValidationState(
  field: AuthStringFieldController,
  submissionAttempts: number
) {
  const showError = field.state.meta.isTouched || submissionAttempts > 0

  return {
    errors: showError ? field.state.meta.errors : undefined,
    invalid: showError && !field.state.meta.isValid,
  }
}

function AccountCreationUsernameField({
  disabled,
  field,
  submissionAttempts,
}: AccountCreationFieldProps) {
  const { errors, invalid } = getFieldValidationState(field, submissionAttempts)

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
      onChange={(value: string) => field.handleChange(value.toLowerCase())}
      invalid={invalid}
      errors={errors}
      description="Lowercase letters, numbers, underscores and hyphens."
      disabled={disabled}
      required
    />
  )
}

function AccountCreationEmailField({
  disabled,
  field,
  submissionAttempts,
}: AccountCreationFieldProps) {
  const { errors, invalid } = getFieldValidationState(field, submissionAttempts)

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
      errors={errors}
      disabled={disabled}
      required
    />
  )
}

function AccountCreationPasswordField({
  disabled,
  field,
  showPassword,
  submissionAttempts,
  togglePassword,
}: PasswordAccountCreationFieldProps) {
  const { errors, invalid } = getFieldValidationState(field, submissionAttempts)

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
      errors={errors}
      description="Use at least 8 characters."
      disabled={disabled}
      showPassword={showPassword}
      togglePassword={togglePassword}
      required
    />
  )
}

export function AccountCreationFields({
  Field,
  disabled,
  includePassword = true,
  showPassword,
  submissionAttempts,
  togglePassword,
}: {
  Field: AccountCreationFieldComponent
  disabled: boolean
  includePassword?: boolean
  showPassword: boolean
  submissionAttempts: number
  togglePassword: () => void
}) {
  return (
    <>
      <Field
        name="username"
        validators={{
          onChange: ({ value }) => validateUsername(value.trim()),
        }}
      >
        {(field) => (
          <AccountCreationUsernameField
            disabled={disabled}
            field={field}
            submissionAttempts={submissionAttempts}
          />
        )}
      </Field>

      <Field
        name="email"
        validators={{
          onChange: ({ value }) => validateEmail(value),
        }}
      >
        {(field) => (
          <AccountCreationEmailField
            disabled={disabled}
            field={field}
            submissionAttempts={submissionAttempts}
          />
        )}
      </Field>

      {includePassword ? (
        <Field
          name="password"
          validators={{
            onChange: ({ value }) => validatePassword(value),
          }}
        >
          {(field) => (
            <AccountCreationPasswordField
              disabled={disabled}
              field={field}
              showPassword={showPassword}
              submissionAttempts={submissionAttempts}
              togglePassword={togglePassword}
            />
          )}
        </Field>
      ) : null}
    </>
  )
}
