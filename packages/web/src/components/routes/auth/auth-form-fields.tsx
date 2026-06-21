import { Button } from "@alloy/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@alloy/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import type {
  ComponentProps,
  FocusEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react"

type BaseFieldProps = {
  description?: ReactNode
  disabled?: boolean
  errors?: Array<unknown>
  headerAction?: ReactNode
  icon: ReactNode
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
    ComponentProps<typeof InputGroupInput>,
    | "autoCapitalize"
    | "autoComplete"
    | "autoCorrect"
    | "inputMode"
    | "spellCheck"
    | "type"
  >

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
  action?: ReactNode
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
  children: ReactNode
  description?: ReactNode
  errors?: Array<unknown>
  headerAction?: ReactNode
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
  trailingAddon?: ReactNode
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
  children: ReactNode,
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
  inputProps: ComponentProps<typeof AuthInputGroupField>,
) {
  return renderAuthInputFieldFrame(
    frameProps,
    <AuthInputGroupField {...inputProps} />,
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
  ComponentProps<typeof AuthInputGroupField>,
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
    ComponentProps<typeof AuthInputGroupField>,
    keyof ReturnType<typeof createAuthInputGroupBaseProps>
  >,
) {
  return renderAuthTextLikeField(frameProps, {
    ...baseInputProps,
    ...extraInputProps,
  })
}

function createAuthInputField<TProps extends TextFieldProps>(
  buildExtraInputProps: (
    props: TProps,
  ) => Omit<
    ComponentProps<typeof AuthInputGroupField>,
    keyof ReturnType<typeof createAuthInputGroupBaseProps>
  >,
) {
  return function AuthInputField(props: TProps) {
    const { baseInputProps, frameProps } = createAuthTextFieldProps(props)

    return renderAuthTextField(
      frameProps,
      baseInputProps,
      buildExtraInputProps(props),
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
  }),
)

export function AuthSubmitButton({
  canSubmit,
  children,
  isSubmitting,
  onFocus,
  onPointerEnter,
  pendingLabel,
}: {
  canSubmit: boolean
  children: ReactNode
  isSubmitting: boolean
  onFocus?: FocusEventHandler<HTMLButtonElement>
  onPointerEnter?: PointerEventHandler<HTMLButtonElement>
  pendingLabel: string
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={!canSubmit}
      onFocus={onFocus}
      onPointerEnter={onPointerEnter}
    >
      {isSubmitting ? pendingLabel : children}
    </Button>
  )
}
