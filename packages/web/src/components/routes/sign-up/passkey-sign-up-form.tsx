import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowRightIcon, KeyRoundIcon, UserIcon } from "lucide-react"
import { useCallback } from "react"

import { fieldErrorState } from "@/components/routes/field-error-state"
import { authClient } from "@/lib/auth-client"
import {
  completeAuthSessionFlow,
  toastAuthAttemptFailure,
} from "@/lib/auth-flow"
import { validateUsername } from "@/lib/form-validators"
import { invalidateAuthConfig } from "@/lib/session-suspense"

type PasskeySignUpFormState = {
  username: string
}

type PasskeySignUpFormProps = {
  redirectTo?: "/" | "/setup" | "/settings"
}

function usePasskeySignUpSubmit({ redirectTo = "/" }: PasskeySignUpFormProps) {
  const router = useRouter()
  const navigate = useNavigate()

  return useCallback(
    async (form: PasskeySignUpFormState) => {
      try {
        const { error } = await authClient.passkey.signUp({
          username: form.username.trim(),
        })
        if (error) {
          toastAuthAttemptFailure(
            "passkey sign-up",
            message("Couldn't create your passkey account"),
            error,
          )
          return
        }
        invalidateAuthConfig()
        await completeAuthSessionFlow({
          invalidateRouter: () => router.invalidate(),
          navigate: () =>
            redirectTo === "/"
              ? navigate({ to: "/", search: { welcome: "1" } })
              : navigate({ to: redirectTo }),
        })
      } catch (cause) {
        toastAuthAttemptFailure(
          "passkey sign-up",
          message("Couldn't finish passkey account setup"),
          cause,
        )
      }
    },
    [navigate, redirectTo, router],
  )
}

export function PasskeySignUpForm(props: PasskeySignUpFormProps) {
  const submit = usePasskeySignUpSubmit(props)
  const form = useForm({
    defaultValues: {
      username: "",
    } satisfies PasskeySignUpFormState,
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
        {(field) => {
          const { errors, invalid } = fieldErrorState(
            field.state.meta,
            submissionAttempts,
          )
          return (
            <Field>
              <FieldLabel htmlFor={field.name} required>
                {t("Username")}
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <UserIcon />
                </InputGroupAddon>
                <InputGroupInput
                  id={field.name}
                  type="text"
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="alloy"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? `${field.name}-error` : undefined}
                  aria-required
                  disabled={isSubmitting}
                />
              </InputGroup>
              <FieldError id={`${field.name}-error`} errors={errors} />
            </Field>
          )
        }}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
            onFocus={authClient.passkey.preload}
            onPointerEnter={authClient.passkey.preload}
          >
            {isSubmitting ? (
              t("Waiting for authenticator…")
            ) : (
              <>
                <KeyRoundIcon className="size-4" />
                {t("Create account with passkey")}
                <ArrowRightIcon />
              </>
            )}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
