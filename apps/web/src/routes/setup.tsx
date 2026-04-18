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
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../lib/auth-client"
import { fetchAuthConfig } from "../lib/auth-config"

/**
 * First-admin bootstrap — the only public sign-up surface. The server's
 * user-create hook is the real guard; this redirect is UX.
 */
export const Route = createFileRoute("/setup")({
  loader: async () => {
    const config = await fetchAuthConfig()
    if (!config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    return config
  },
  component: SetupPage,
})

function SetupPage() {
  const router = useRouter()
  const navigate = useNavigate()

  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const { error: err } = await authClient.signUp.email({
        name,
        email,
        password,
      })
      if (err) {
        toast.error("Couldn't create the admin account", {
          description: err.message ?? "Please review the form and try again.",
        })
        return
      }
      // better-auth auto-signs-in on sign-up; the server's user-create
      // hook promotes this first account to admin.
      toast.success("Admin account ready", {
        description: "Welcome — you can configure OAuth from here.",
      })
      await router.invalidate()
      await navigate({ to: "/admin" })
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AlloyLogo showText size={32} />
          <Badge variant="accent">First-run setup</Badge>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Create the admin account
            </h1>
            <p className="text-sm text-foreground-muted">
              This is the only user that can be created from the public
              surface. All further accounts come in through OAuth once you've
              configured a provider.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="setup-name">Display name</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <UserIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="setup-name"
                type="text"
                autoComplete="name"
                placeholder="Alice Admin"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
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
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-foreground-muted">
          After this, sign-up is disabled — the only way to add users is by
          configuring an OAuth provider in the admin console.
        </p>
      </div>
    </div>
  )
}
