import * as React from "react"
import { useForm } from "@tanstack/react-form"
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
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "@/lib/auth-client"
import { validateRequiredString, validateUsername } from "@/lib/form-validators"
import { avatarTint, displayInitials, displayName } from "@/lib/user-display"

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
  const form = useForm({
    defaultValues: {
      name: initialName,
      username: initialUsername,
    } as { name: string; username: string },
    onSubmit: async ({ value }) => {
      const trimmedName = value.name.trim()
      const trimmedUsername = value.username.trim()
      const nameDirty = trimmedName !== initialName.trim()
      const usernameDirty = trimmedUsername !== initialUsername.trim()

      if (!nameDirty && !usernameDirty) {
        return
      }

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
      }
    },
  })

  React.useEffect(() => {
    form.reset({
      name: initialName,
      username: initialUsername,
    })
  }, [form, initialName, initialUsername])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <Card>
        <CardContent className="flex flex-col gap-4">
          <form.Subscribe selector={(state) => state.values.name}>
            {(currentName) => {
              const previewName = displayName({
                id: userId,
                name: currentName.trim() || null,
                email,
                image: image || null,
              })
              const initials = displayInitials(previewName)
              const { bg, fg } = avatarTint(userId || previewName)

              return (
                <div className="flex items-center gap-4">
                  <Avatar size="xl" style={{ background: bg, color: fg }}>
                    {image ? (
                      <AvatarImage src={image} alt={previewName} />
                    ) : null}
                    <AvatarFallback style={{ background: bg, color: fg }}>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {previewName}
                    </span>
                    <span className="text-sm text-foreground-faint">
                      {email}
                    </span>
                  </div>
                </div>
              )
            }}
          </form.Subscribe>

          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) =>
                validateRequiredString(value, "Display name"),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Display name
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="text"
                    autoComplete="name"
                    value={field.state.value}
                    maxLength={128}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>

          <form.Field
            name="username"
            validators={{
              onChange: ({ value }) => validateUsername(value.trim()),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Username
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(e.target.value.toLowerCase())
                    }
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldDescription>
                    Lowercase letters, numbers, underscores and hyphens. Used in
                    your profile URL.
                  </FieldDescription>
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>
        </CardContent>

        <CardFooter>
          <form.Subscribe
            selector={(state) =>
              [
                state.values.name,
                state.values.username,
                state.canSubmit,
                state.isSubmitting,
              ] as const
            }
          >
            {([currentName, currentUsername, canSubmit, isSubmitting]) => {
              const dirty =
                currentName.trim() !== initialName.trim() ||
                currentUsername.trim() !== initialUsername.trim()

              return (
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!dirty || !canSubmit}
                >
                  {isSubmitting ? "Saving…" : "Save changes"}
                </Button>
              )
            }}
          </form.Subscribe>
        </CardFooter>
      </Card>
    </form>
  )
}
