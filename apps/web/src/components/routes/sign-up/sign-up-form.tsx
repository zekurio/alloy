import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"

type SignUpFormState = {
  username: string
  email: string
  password: string
}

type SignUpFieldsProps = {
  username: string
  email: string
  password: string
  showPassword: boolean
  pending: boolean
  onUsernameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onTogglePassword: () => void
}

function useSignUpSubmit() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  const submit = async (form: SignUpFormState) => {
    if (pending) return
    setPending(true)
    try {
      const { error: err } = await authClient.signUp.email({
        name: form.username,
        email: form.email,
        password: form.password,
      })
      if (err) {
        toast.error("Couldn't create your account", {
          description: err.message ?? "Please review the form and try again.",
        })
        return
      }
      await router.invalidate()
      await navigate({ to: "/" })
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

function SignUpFields({
  username,
  email,
  password,
  showPassword,
  pending,
  onUsernameChange,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
}: SignUpFieldsProps) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="signup-username">Username</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <UserIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="signup-username"
            type="text"
            autoComplete="username"
            placeholder="alice"
            required
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            disabled={pending}
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="signup-email">Email</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <MailIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={pending}
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="signup-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <LockIcon />
          </InputGroupAddon>
          <InputGroupInput
            id="signup-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={pending}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={onTogglePassword}
              disabled={pending}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

    </>
  )
}

export function SignUpForm() {
  const { pending, submit } = useSignUpSubmit()
  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit({ username, email, password })
      }}
      className="flex flex-col gap-4"
    >
      <SignUpFields
        username={username}
        email={email}
        password={password}
        showPassword={showPassword}
        pending={pending}
        onUsernameChange={setUsername}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onTogglePassword={() => setShowPassword((v) => !v)}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Creating account…" : "Create account"}
        <ArrowRightIcon />
      </Button>
    </form>
  )
}
