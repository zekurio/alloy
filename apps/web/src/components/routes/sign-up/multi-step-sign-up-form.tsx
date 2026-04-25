import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowLeftIcon, ArrowRightIcon, KeyRoundIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { FieldSeparator } from "@workspace/ui/components/field"
import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/form-validators"
import { addPasskeyWithLabel } from "@/lib/passkeys"
import {
  AccountCreationEmailField,
  AccountCreationPasswordField,
  AccountCreationUsernameField,
} from "../auth/account-creation-fields"
import { AuthSubmitButton } from "../auth/auth-form-fields"

export type SignUpStep = "identity" | "method"

type IdentityData = {
  username: string
  email: string
}

function usePasswordSignUpSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (form: IdentityData & { password: string }) => {
      try {
        const { error } = await authClient.signUp.email({
          name: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        })
        if (error) {
          toast.error("Couldn't create your account")
          return
        }
        await router.invalidate()
        await navigate({ to: "/" })
      } catch {
        toast.error("Unexpected error")
      }
    },
    [navigate, router]
  )
}

function usePasskeySignUpSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (identity: IdentityData) => {
      try {
        const { context } = await api.authConfig.createPasskeySignUp({
          email: identity.email.trim(),
          username: identity.username.trim().toLowerCase(),
        })
        const { error } = await addPasskeyWithLabel({
          context,
          label: `${identity.username.trim()}'s passkey`,
        })
        if (error) {
          toast.error("Couldn't create your passkey account")
          return
        }
        await authClient.getSession()
        await router.invalidate()
        await navigate({ to: "/" })
      } catch {
        toast.error("Unexpected error")
      }
    },
    [navigate, router]
  )
}

function IdentityStep({
  defaultValues,
  onContinue,
}: {
  defaultValues: IdentityData
  onContinue: (data: IdentityData) => void
}) {
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      onContinue({
        username: value.username.trim(),
        email: value.email.trim(),
      })
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
          <AccountCreationUsernameField
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
          <AccountCreationEmailField
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
            pendingLabel="Continuing…"
          >
            <>
              Continue
              <ArrowRightIcon />
            </>
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}

function MethodStep({
  identity,
  onBack,
}: {
  identity: IdentityData
  onBack: () => void
}) {
  const submitPassword = usePasswordSignUpSubmit()
  const submitPasskey = usePasskeySignUpSubmit()
  const [passkeyPending, setPasskeyPending] = React.useState(false)

  const passwordForm = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      await submitPassword({ ...identity, password: value.password })
    },
  })
  const [showPassword, setShowPassword] = React.useState(false)
  const submissionAttempts = passwordForm.state.submissionAttempts
  const isSubmitting = passwordForm.state.isSubmitting

  const handlePasskey = async () => {
    setPasskeyPending(true)
    try {
      await submitPasskey(identity)
    } finally {
      setPasskeyPending(false)
    }
  }

  const disabled = isSubmitting || passkeyPending

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void passwordForm.handleSubmit()
        }}
        className="flex flex-col gap-5"
      >
        <passwordForm.Field
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
              togglePassword={() => setShowPassword((v) => !v)}
            />
          )}
        </passwordForm.Field>

        <passwordForm.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([canSubmit, isSubmitting]) => (
            <AuthSubmitButton
              canSubmit={canSubmit && !passkeyPending}
              isSubmitting={isSubmitting}
              pendingLabel="Creating account…"
            >
              <>
                Create account
                <ArrowRightIcon />
              </>
            </AuthSubmitButton>
          )}
        </passwordForm.Subscribe>
      </form>

      <FieldSeparator>OR</FieldSeparator>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        disabled={disabled}
        onClick={() => void handlePasskey()}
      >
        {passkeyPending ? (
          "Waiting for authenticator…"
        ) : (
          <>
            <KeyRoundIcon className="size-4" />
            Use a passkey instead
            <ArrowRightIcon />
          </>
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-center"
        onClick={onBack}
        disabled={disabled}
      >
        <ArrowLeftIcon className="size-4" />
        Back
      </Button>
    </div>
  )
}

export function MultiStepSignUpForm({
  onStepChange,
}: {
  onStepChange?: (step: SignUpStep) => void
}) {
  const [identity, setIdentity] = React.useState<IdentityData | null>(null)
  const [savedIdentity, setSavedIdentity] = React.useState<IdentityData>({
    username: "",
    email: "",
  })

  const handleContinue = React.useCallback(
    (data: IdentityData) => {
      setSavedIdentity(data)
      setIdentity(data)
      onStepChange?.("method")
    },
    [onStepChange]
  )

  const handleBack = React.useCallback(() => {
    setIdentity(null)
    onStepChange?.("identity")
  }, [onStepChange])

  if (!identity) {
    return (
      <IdentityStep defaultValues={savedIdentity} onContinue={handleContinue} />
    )
  }

  return <MethodStep identity={identity} onBack={handleBack} />
}
