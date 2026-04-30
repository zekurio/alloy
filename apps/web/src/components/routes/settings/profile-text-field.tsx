import * as React from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

type ProfileFieldController = {
  name: string
  state: {
    value: string
    meta: {
      errors: Array<unknown>
      isTouched: boolean
      isValid: boolean
    }
  }
  handleBlur: () => void
  handleChange: (value: string) => void
}

export function ProfileTextField({
  autoComplete,
  description,
  field,
  isSubmitting,
  label,
  onChangeValue,
  submissionAttempts,
  type,
}: {
  autoComplete: string
  description?: React.ReactNode
  field: ProfileFieldController
  isSubmitting: boolean
  label: string
  onChangeValue?: (value: string) => string
  submissionAttempts: number
  type: "email" | "text"
}) {
  const showError = field.state.meta.isTouched || submissionAttempts > 0
  const invalid = showError && !field.state.meta.isValid
  const hintId = description ? `${field.name}-hint` : undefined

  return (
    <Field>
      <FieldLabel htmlFor={field.name} required>
        {label}
      </FieldLabel>
      <Input
        id={field.name}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) =>
          field.handleChange(onChangeValue?.(e.target.value) ?? e.target.value)
        }
        disabled={isSubmitting}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${field.name}-error` : hintId}
      />
      {description ? (
        <FieldDescription id={hintId}>{description}</FieldDescription>
      ) : null}
      <FieldError
        id={`${field.name}-error`}
        errors={showError ? field.state.meta.errors : undefined}
      />
    </Field>
  )
}
