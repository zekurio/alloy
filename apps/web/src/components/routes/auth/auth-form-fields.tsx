import * as React from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

type BaseFieldProps = {
  description?: React.ReactNode
  disabled?: boolean
  errors?: Array<unknown>
  headerAction?: React.ReactNode
  icon: React.ReactNode
  id: string
  invalid: boolean
  label: string
  onBlur: () => void
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  value: string
}

type TextFieldProps = BaseFieldProps &
  Pick<
    React.ComponentProps<typeof InputGroupInput>,
    | "autoCapitalize"
    | "autoComplete"
    | "autoCorrect"
    | "inputMode"
    | "spellCheck"
    | "type"
  >

function FieldHeader({
  action,
  id,
  label,
  required,
}: {
  action?: React.ReactNode
  id: string
  label: string
  required?: boolean
}) {
  if (!action) {
    return (
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
    )
  }

  return (
    <div className="flex items-center justify-between">
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {action}
    </div>
  )
}

function AuthFieldFrame({
  children,
  description,
  errors,
  headerAction,
  id,
  label,
  required,
}: {
  children: React.ReactNode
  description?: React.ReactNode
  errors?: Array<unknown>
  headerAction?: React.ReactNode
  id: string
  label: string
  required?: boolean
}) {
  return (
    <Field>
      <FieldHeader
        action={headerAction}
        id={id}
        label={label}
        required={required}
      />
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError id={`${id}-error`} errors={errors} />
    </Field>
  )
}

export function FormInputField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  description,
  disabled,
  errors,
  headerAction,
  icon,
  id,
  inputMode,
  invalid,
  label,
  onBlur,
  onChange,
  placeholder,
  required,
  spellCheck,
  type = "text",
  value,
}: TextFieldProps) {
  return (
    <AuthFieldFrame
      description={description}
      errors={errors}
      headerAction={headerAction}
      id={id}
      label={label}
      required={required}
    >
      <InputGroup>
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput
          id={id}
          type={type}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          inputMode={inputMode}
          spellCheck={spellCheck}
          placeholder={placeholder}
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          disabled={disabled}
        />
      </InputGroup>
    </AuthFieldFrame>
  )
}

type PasswordFieldProps = BaseFieldProps & {
  autoComplete: string
  showPassword: boolean
  togglePassword: () => void
}

export function PasswordInputField({
  autoComplete,
  description,
  disabled,
  errors,
  headerAction,
  icon,
  id,
  invalid,
  label,
  onBlur,
  onChange,
  placeholder,
  required,
  showPassword,
  togglePassword,
  value,
}: PasswordFieldProps) {
  return (
    <AuthFieldFrame
      description={description}
      errors={errors}
      headerAction={headerAction}
      id={id}
      label={label}
      required={required}
    >
      <InputGroup>
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput
          id={id}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={togglePassword}
            disabled={disabled}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </AuthFieldFrame>
  )
}

export function AuthSubmitButton({
  canSubmit,
  children,
  isSubmitting,
  pendingLabel,
}: {
  canSubmit: boolean
  children: React.ReactNode
  isSubmitting: boolean
  pendingLabel: string
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={!canSubmit}
    >
      {isSubmitting ? pendingLabel : children}
    </Button>
  )
}
