import type { AccountRecovery } from "@alloy/contracts"
import { AUTH_ERROR_CODES } from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { useForm } from "@tanstack/react-form"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import {
  ArrowRightIcon,
  KeyRoundIcon,
  KeySquareIcon,
  UserIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { SignInReactivationPrompt } from "@/components/account/reactivate-account-prompt"
import { RecoveryKeyDisplay } from "@/components/auth/recovery-key-display"
import { fieldErrorState } from "@/components/routes/field-error-state"
import { authClient } from "@/lib/auth-client"
import { toastAuthAttemptFailure } from "@/lib/auth-flow"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { passkeysSupported } from "@/lib/passkey-support"

/**
 * Set while this page shows the key a recovery just made. The recovery
 * signed the person in, and any router invalidation reruns the guard below,
 * which would send them home before they saved the new key.
 */
let showingNewKey = false

/**
 * The way back in after losing every passkey: a username and the account's
 * recovery key create a new passkey and sign in. The key is used up, so the
 * page shows its replacement.
 */
export const Route = createFileRoute("/(auth)/_auth/recover")({
  beforeLoad: ({ context }) => {
    if (showingNewKey) return
    redirectAuthedBeforeLoad({ context })
    if (!context.authConfig.passkeyEnabled) throw redirect({ to: "/login" })
  },
  component: RecoverPage,
})

function RecoverPage() {
  const [recovery, setRecovery] = useState<AccountRecovery | null>(null)
  const [reactivationRequired, setReactivationRequired] = useState(false)
  const navigate = useNavigate()
  const router = useRouter()

  // Leaving the page by any way drops the flag, so the guard works again.
  useEffect(
    () => () => {
      showingNewKey = false
    },
    [],
  )

  if (recovery) {
    return (
      <RecoverFrame
        title={t("Save your new recovery key")}
        description={t(
          "You're signed in with a new passkey. Your old recovery key no longer works.",
        )}
      >
        <div className="flex flex-col gap-6">
          <RecoveryKeyDisplay
            recoveryKey={recovery.recoveryKey}
            username={recovery.session.user.username}
          />
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            onClick={async () => {
              // Leave before reloading, then let the guard work again.
              await navigate({ to: "/", replace: true })
              showingNewKey = false
              await router.invalidate()
            }}
          >
            {t("I've saved it")}
            <ArrowRightIcon />
          </Button>
        </div>
      </RecoverFrame>
    )
  }

  if (!passkeysSupported()) {
    return (
      <RecoverFrame
        title={t("This browser does not support passkeys.")}
        description={t(
          "Getting back in creates a new passkey. Open this page in a browser that supports them.",
        )}
      >
        <BackToSignIn />
      </RecoverFrame>
    )
  }

  return (
    <RecoverFrame
      title={t("Get back into your account")}
      description={t(
        "Enter your username and recovery key. You'll create a new passkey and be signed in.",
      )}
    >
      <RecoverForm
        onRecovered={(result) => {
          showingNewKey = true
          setRecovery(result)
        }}
        onReactivationRequired={() => setReactivationRequired(true)}
      />
      <BackToSignIn />
      <SignInReactivationPrompt
        open={reactivationRequired}
        onDismiss={() => setReactivationRequired(false)}
      />
    </RecoverFrame>
  )
}

type RecoverFormState = {
  username: string
  recoveryKey: string
}

function RecoverForm({
  onRecovered,
  onReactivationRequired,
}: {
  onRecovered: (recovery: AccountRecovery) => void
  onReactivationRequired: () => void
}) {
  const form = useForm({
    defaultValues: {
      username: "",
      recoveryKey: "",
    } satisfies RecoverFormState,
    onSubmit: async ({ value }) => {
      try {
        // The server ignores case, spaces and hyphens in the key.
        const { data, error } = await authClient.passkey.recover({
          username: value.username.trim(),
          recoveryKey: value.recoveryKey.trim(),
        })
        if (error || !data) {
          if (error?.code === AUTH_ERROR_CODES.accountReactivationRequired) {
            onReactivationRequired()
          } else {
            toastAuthAttemptFailure(
              "account recovery",
              message("Account recovery failed"),
              error,
            )
          }
          return
        }
        onRecovered(data)
      } catch (cause) {
        toastAuthAttemptFailure(
          "account recovery",
          message("Account recovery failed"),
          cause,
        )
      }
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
          onChange: ({ value }) =>
            value.trim() ? undefined : t("Username can't be empty"),
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

      <form.Field
        name="recoveryKey"
        validators={{
          onChange: ({ value }) =>
            value.trim() ? undefined : t("Enter your recovery key"),
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
                {t("Recovery key")}
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <KeySquareIcon />
                </InputGroupAddon>
                <InputGroupInput
                  id={field.name}
                  type="text"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX-XXXX-XXXX-…"
                  className="font-mono"
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
                {t("Create passkey and sign in")}
              </>
            )}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

function BackToSignIn() {
  return (
    <p className="text-foreground-muted mt-6 text-sm">
      <Link
        to="/login"
        className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline"
      >
        {t("Back to sign in")}
      </Link>
    </p>
  )
}

function RecoverFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-foreground-muted text-sm">{description}</p>
      </div>
      {children}
    </>
  )
}
