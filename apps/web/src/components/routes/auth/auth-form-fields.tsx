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

export type AuthFieldMetaState = {
  errors: Array<unknown>
  isTouched: boolean
  isValid: boolean
}

export type AuthStringFieldController = {
  handleBlur: () => void
  handleChange: (value: string) => void
  name: string
  state: {
    meta: AuthFieldMetaState
    value: string
  }
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

type PasswordFieldProps = BaseFieldProps & {
  autoComplete: string
  showPassword: boolean
  togglePassword: () => void
}

type SharedAuthTextFieldProps = Pick<
  TextFieldProps,
  | "description"
  | "disabled"
  | "errors"
  | "headerAction"
  | "icon"
  | "id"
  | "invalid"
  | "label"
  | "onBlur"
  | "onChange"
  | "placeholder"
  | "required"
  | "value"
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

function AuthInputGroupField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  disabled,
  icon,
  id,
  inputMode,
  invalid,
  onBlur,
  onChange,
  placeholder,
  required,
  spellCheck,
  trailingAddon,
  type,
  value,
}: Pick<
  TextFieldProps,
  | "autoCapitalize"
  | "autoComplete"
  | "autoCorrect"
  | "disabled"
  | "icon"
  | "id"
  | "inputMode"
    | "invalid"
    | "onBlur"
    | "onChange"
    | "placeholder"
    | "required"
    | "spellCheck"
    | "type"
    | "value"
> & {
  trailingAddon?: React.ReactNode
}) {
  return (
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
        aria-required={required || undefined}
        disabled={disabled}
      />
      {trailingAddon}
    </InputGroup>
  )
}

function renderAuthInputFieldFrame(
  {
    description,
    errors,
    headerAction,
    id,
    label,
    required,
  }: Pick<
    TextFieldProps,
    "description" | "errors" | "headerAction" | "id" | "label" | "required"
  >,
  children: React.ReactNode
) {
  return (
    <AuthFieldFrame
      description={description}
      errors={errors}
      headerAction={headerAction}
      id={id}
      label={label}
      required={required}
    >
      {children}
    </AuthFieldFrame>
  )
}

function renderAuthTextLikeField(
  frameProps: Pick<
    TextFieldProps,
    "description" | "errors" | "headerAction" | "id" | "label" | "required"
  >,
  inputProps: React.ComponentProps<typeof AuthInputGroupField>
) {
  return renderAuthInputFieldFrame(
    frameProps,
    <AuthInputGroupField {...inputProps} />
  )
}

function createAuthInputGroupBaseProps({
  disabled,
  icon,
  id,
  invalid,
  onBlur,
  onChange,
  placeholder,
  required,
  value,
}: Pick<
  React.ComponentProps<typeof AuthInputGroupField>,
  | "disabled"
  | "icon"
  | "id"
  | "invalid"
  | "onBlur"
  | "onChange"
  | "placeholder"
  | "required"
  | "value"
>) {
  return {
    disabled,
    icon,
    id,
    invalid,
    onBlur,
    onChange,
    placeholder,
    required,
    value,
  }
}

function createAuthTextFieldProps({
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
  value,
}: SharedAuthTextFieldProps) {
  return {
    frameProps: {
      description,
      errors,
      headerAction,
      id,
      label,
      required,
    },
    baseInputProps: createAuthInputGroupBaseProps({
      disabled,
      icon,
      id,
      invalid,
      onBlur,
      onChange,
      placeholder,
      required,
      value,
    }),
  }
}

function renderAuthTextField(
  frameProps: Pick<
    TextFieldProps,
    "description" | "errors" | "headerAction" | "id" | "label" | "required"
  >,
  baseInputProps: ReturnType<typeof createAuthInputGroupBaseProps>,
  extraInputProps: Omit<
    React.ComponentProps<typeof AuthInputGroupField>,
    keyof ReturnType<typeof createAuthInputGroupBaseProps>
  >
) {
  return renderAuthTextLikeField(frameProps, {
    ...baseInputProps,
    ...extraInputProps,
  })
}

function createAuthInputField<TProps extends TextFieldProps | PasswordFieldProps>(
  buildExtraInputProps: (
    props: TProps
  ) => Omit<
    React.ComponentProps<typeof AuthInputGroupField>,
    keyof ReturnType<typeof createAuthInputGroupBaseProps>
  >
) {
  return function AuthInputField(props: TProps) {
    const { baseInputProps, frameProps } = createAuthTextFieldProps(props)

    return renderAuthTextField(
      frameProps,
      baseInputProps,
      buildExtraInputProps(props)
    )
  }
}

export const FormInputField = createAuthInputField<TextFieldProps>(
  ({
    autoCapitalize,
    autoComplete,
    autoCorrect,
    inputMode,
    spellCheck,
    type = "text",
  }) => ({
    autoCapitalize,
    autoComplete,
    autoCorrect,
    inputMode,
    spellCheck,
    type,
  })
)

export const PasswordInputField = createAuthInputField<PasswordFieldProps>(
  ({ autoComplete, disabled, showPassword, togglePassword }) => ({
      autoComplete,
      type: showPassword ? "text" : "password",
      trailingAddon: (
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
      ),
    })
)

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
