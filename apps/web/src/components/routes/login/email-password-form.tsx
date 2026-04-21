import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { AtSignIcon, EyeIcon, EyeOffIcon, LockIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"

type LoginCredentials = {
  identifier: string
  password: string
  rememberMe: boolean
}

function useEmailPasswordSubmit() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  const submit = async (creds: LoginCredentials) => {
    if (pending) return
    setPending(true)
    try {
      const isEmail = creds.identifier.includes("@")
      const { error: err } = isEmail
        ? await authClient.signIn.email({
            email: creds.identifier,
            password: creds.password,
            rememberMe: creds.rememberMe,
          })
        : await authClient.signIn.username({
            username: creds.identifier,
            password: creds.password,
            rememberMe: creds.rememberMe,
          })
      if (err) {
        toast.error("Couldn't sign in", {
          description:
            err.message ?? "Check your details and try again.",
        })
        return
      }
      await router.invalidate()
      await navigate({ to: "/" })
    } catch (cause) {
      toast.error("Unexpected sign-in error", {
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

function IdentifierField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Field>
      <FieldLabel htmlFor="login-identifier">Email or username</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <AtSignIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="login-identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com or yourhandle"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </InputGroup>
    </Field>
  )
}

function PasswordField({
  password,
  onChange,
  disabled,
}: {
  password: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [showPassword, setShowPassword] = React.useState(false)
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor="login-password">Password</FieldLabel>
        <a
          href="#"
          className="text-xs text-foreground-muted underline-offset-4 hover:text-accent hover:underline"
        >
          Forgot?
        </a>
      </div>
      <InputGroup>
        <InputGroupAddon>
          <LockIcon />
        </InputGroupAddon>
        <InputGroupInput
          id="login-password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((v) => !v)}
            disabled={disabled}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

export function EmailPasswordForm() {
  const { pending, submit } = useEmailPasswordSubmit()
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [rememberMe, setRememberMe] = React.useState(true)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit({ identifier, password, rememberMe })
      }}
      className="flex flex-col gap-4"
    >
      <IdentifierField
        value={identifier}
        onChange={setIdentifier}
        disabled={pending}
      />
      <PasswordField
        password={password}
        onChange={setPassword}
        disabled={pending}
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-muted select-none">
        <Checkbox
          checked={rememberMe}
          onCheckedChange={(value) => setRememberMe(value === true)}
          disabled={pending}
        />
        Keep me signed in
      </label>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
