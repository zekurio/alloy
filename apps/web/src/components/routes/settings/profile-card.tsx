import * as React from "react"
import { useRouter } from "@tanstack/react-router"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter } from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"
import {
  avatarTint,
  displayInitials,
  displayName,
} from "../../../lib/user-display"

const USERNAME_MIN_LEN = 1
const USERNAME_MAX_LEN = 24
const USERNAME_RE = /^[a-z0-9_-]+$/

type ProfileCardProps = {
  userId: string
  initialName: string
  initialUsername: string
  image: string
  email: string
}

export function ProfileCard({
  userId,
  initialName,
  initialUsername,
  image,
  email,
}: ProfileCardProps) {
  const router = useRouter()
  const [name, setName] = React.useState(initialName)
  const [username, setUsername] = React.useState(initialUsername)
  const [pending, setPending] = React.useState(false)

  const trimmedName = name.trim()
  const trimmedUsername = username.trim()

  const nameDirty = trimmedName !== initialName.trim()
  const usernameDirty = trimmedUsername !== initialUsername.trim()
  const dirty = nameDirty || usernameDirty

  const usernameError = usernameDirty
    ? validateUsername(trimmedUsername)
    : null

  const preview = {
    name: displayName({
      id: userId,
      name: trimmedName || null,
      email,
      image: image || null,
    }),
    image: image || undefined,
  }
  const initials = displayInitials(preview.name)
  const { bg, fg } = avatarTint(userId || preview.name)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || !dirty) return
    if (usernameError) {
      toast.error(usernameError)
      return
    }
    setPending(true)
    try {
      if (nameDirty) {
        const { error } = await authClient.updateUser({ name: trimmedName })
        if (error) {
          toast.error(error.message ?? "Couldn't save")
          return
        }
      }
      if (usernameDirty) {
        const { error } = await authClient.updateUser({
          username: trimmedUsername,
        })
        if (error) {
          toast.error(error.message ?? "Couldn't update username")
          return
        }
      }
      toast.success("Saved")
      await router.invalidate()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Avatar size="xl" style={{ background: bg, color: fg }}>
              {preview.image ? (
                <AvatarImage src={preview.image} alt={preview.name} />
              ) : null}
              <AvatarFallback style={{ background: bg, color: fg }}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {preview.name}
              </span>
              <span className="font-mono text-2xs text-foreground-faint">
                {email}
              </span>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
            <Input
              id="profile-name"
              type="text"
              autoComplete="name"
              value={name}
              required
              maxLength={128}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="profile-username">Username</FieldLabel>
            <Input
              id="profile-username"
              type="text"
              autoComplete="username"
              value={username}
              required
              minLength={USERNAME_MIN_LEN}
              maxLength={USERNAME_MAX_LEN}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              disabled={pending}
              aria-invalid={usernameError ? true : undefined}
            />
            <FieldDescription>
              {usernameError ??
                "Lowercase letters, numbers, underscores and hyphens. Used in your profile URL."}
            </FieldDescription>
          </Field>
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || !dirty || Boolean(usernameError)}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function validateUsername(value: string): string | null {
  if (value.length < USERNAME_MIN_LEN) return "Username can't be empty"
  if (value.length > USERNAME_MAX_LEN)
    return `Username can be at most ${USERNAME_MAX_LEN} characters`
  if (!USERNAME_RE.test(value))
    return "Only lowercase letters, numbers, underscores and hyphens"
  return null
}
