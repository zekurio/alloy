import * as React from "react"
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from "lucide-react"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../lib/auth-client"
import { fetchAuthConfig } from "../../lib/auth-config"
import { invalidateAuthConfig } from "../../lib/session-suspense"

/**
 * First-admin bootstrap — the only public sign-up surface. The server's
 * user-create hook is the real guard; this redirect is UX.
 */
export const Route = createFileRoute("/(auth)/setup")({
  loader: async () => {
    const config = await fetchAuthConfig()
    if (!config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    return config
  },
  component: SetupPage,
})

type SetupFormState = {
  username: string
  email: string
  password: string
}

function useSetupSubmit() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  const submit = async (form: SetupFormState) => {
    if (pending) return
    setPending(true)
    try {
      const { error: err } = await authClient.signUp.email({
        name: form.username,
        email: form.email,
        password: form.password,
      })
      if (err) {
        toast.error("Couldn't create the admin account", {
          description: err.message ?? "Please review the form and try again.",
        })
        return
      }
      toast.success("Admin account ready", {
        description: "Welcome — you can configure OAuth from here.",
      })
      invalidateAuthConfig()
      await navigate({ to: "/admin-settings" })
      await router.invalidate()
    } catch (cause) {
      toast.error("Unexpected error", {
        description:
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      })
    } finally {
      setPending(false)
    }
  }

  return { pending, submit }
}

function SetupForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (form: SetupFormState) => void
}) {
  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ username, email, password })
      }}
      className="flex flex-col gap-4"
    >
      <Field>
        <FieldLabel htmlFor="setup-username">Username</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <UserIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="setup-username"
            type="text"
            autoComplete="username"
            placeholder="alice"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={pending}
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="setup-email">Email</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <MailIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="setup-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="setup-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <LockIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="setup-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
              disabled={pending}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Creating account…" : "Create admin account"}
        <ArrowRightIcon />
      </Button>
    </form>
  )
}

function SetupPage() {
  const { pending, submit } = useSetupSubmit()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AlloyLogo showText size={32} />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Create the admin account
            </h1>
            <p className="text-sm text-foreground-muted">
              You are the first user, create your admin account. This allows you
              to configure Oauth providers, enable sign-up and seed new users.
            </p>
          </div>
        </div>

        <SetupForm pending={pending} onSubmit={submit} />
      </div>
    </div>
  )
}
