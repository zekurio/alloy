import { useForm } from "@tanstack/react-form"

import { Button } from "@workspace/ui/components/button"
import {
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/lib/toast"

import { authClient } from "@/lib/auth-client"
import { validateEmail, validateUsername } from "@/lib/form-validators"

export function SeedUserDialog({
  onCreated,
}: {
  onCreated: () => void | Promise<void>
}) {
  const form = useForm({
    defaultValues: {
      username: "",
      email: "",
      role: "user" as "user" | "admin",
    } as { username: string; email: string; role: "user" | "admin" },
    onSubmit: async ({ value }) => {
      try {
        const { error } = await authClient.admin.createUser({
          name: value.username.trim(),
          email: value.email.trim(),
          role: value.role,
        })
        if (error) throw new Error(error.message ?? "Create failed")
        toast.success("User seeded")
        form.reset()
        await onCreated()
      } catch {
        toast.error("Couldn't seed user")
      }
    },
  })

  return (
    <DialogContent variant="secondary">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <DialogHeader>
          <DialogTitle>Seed a user</DialogTitle>
          <DialogDescription>
            Creates a passwordless account. The user signs in via OAuth and
            their identity links to this email.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
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
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(e.target.value.toLowerCase())
                    }
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldDescription>
                    Used to sign in. Lowercase letters, numbers, `_` and `-`.
                  </FieldDescription>
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) => validateEmail(value),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Email
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={form.state.isSubmitting}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${field.name}-error` : undefined
                    }
                  />
                  <FieldDescription>
                    Must match the email returned by the OAuth provider.
                  </FieldDescription>
                  <FieldError
                    id={`${field.name}-error`}
                    errors={showError ? field.state.meta.errors : undefined}
                  />
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Role</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as "user" | "admin")
                  }
                  disabled={form.state.isSubmitting}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.state.isSubmitting}
              />
            }
          >
            Cancel
          </DialogClose>
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
              >
                {isSubmitting ? "Seeding..." : "Seed user"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
