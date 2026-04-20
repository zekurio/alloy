import * as React from "react"
import { useRouter } from "@tanstack/react-router"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter } from "@workspace/ui/components/card"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"
import {
  avatarTint,
  displayInitials,
  displayName,
} from "../../../lib/user-display"

type ProfileCardProps = {
  userId: string
  initialName: string
  image: string
  email: string
}

export function ProfileCard({
  userId,
  initialName,
  image,
  email,
}: ProfileCardProps) {
  const router = useRouter()
  const [name, setName] = React.useState(initialName)
  const [pending, setPending] = React.useState(false)

  const trimmedName = name.trim()
  const dirty = trimmedName !== initialName.trim()

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
    setPending(true)
    try {
      const { error } = await authClient.updateUser({
        name: trimmedName,
      })
      if (error) {
        toast.error(error.message ?? "Couldn't save")
        return
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
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || !dirty}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
