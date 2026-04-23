import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"

import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "@/lib/auth-client"
import { AuthSubmitButton } from "../auth/auth-form-fields"
import { AccountCreationFields } from "../auth/account-creation-fields"

type SignUpFormState = {
  username: string
  email: string
  password: string
}

function useSignUpSubmit() {
  const router = useRouter()
  const navigate = useNavigate()

  return React.useCallback(
    async (form: SignUpFormState) => {
      try {
        const { error: err } = await authClient.signUp.email({
          name: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        })
        if (err) {
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

export function SignUpForm() {
  const submit = useSignUpSubmit()
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
      password: "",
    } as SignUpFormState,
    onSubmit: async ({ value }) => {
      await submit(value)
    },
  })
  const [showPassword, setShowPassword] = React.useState(false)
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
      <AccountCreationFields
        Field={form.Field}
        disabled={isSubmitting}
        showPassword={showPassword}
        submissionAttempts={submissionAttempts}
        togglePassword={() => setShowPassword((value) => !value)}
      />
      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <AuthSubmitButton
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            pendingLabel="Creating account…"
          >
            <>
              Create account
              <ArrowRightIcon />
            </>
          </AuthSubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
