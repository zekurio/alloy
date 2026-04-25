import { useForm } from "@tanstack/react-form"

import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@workspace/ui/components/section"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/lib/toast"

import { authClient } from "@/lib/auth-client"
import { validatePassword } from "@/lib/form-validators"

export function PasswordCard() {
  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      revokeOtherSessions: true,
    },
    validators: {
      onSubmit: ({ value }) => {
        if (value.newPassword !== value.confirmPassword) {
          return "New passwords must match"
        }
        return undefined
      },
    },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: value.revokeOtherSessions,
      })

      if (error) {
        toast.error(error.message ?? "Couldn't change password")
        return
      }

      toast.success("Password changed")
      form.reset()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <Section>
        <SectionContent className="flex flex-col gap-4 py-4">
          <form.Field
            name="currentPassword"
            validators={{
              onChange: ({ value }) =>
                value.length === 0 ? "Current password is required" : undefined,
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Current password
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="current-password"
                    value={field.state.value}
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
            name="newPassword"
            validators={{
              onChange: ({ value }) => validatePassword(value),
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    New password
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="new-password"
                    value={field.state.value}
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
            name="confirmPassword"
            validators={{
              onChangeListenTo: ["newPassword"],
              onChange: ({ value, fieldApi }) =>
                value !== fieldApi.form.getFieldValue("newPassword")
                  ? "Passwords must match"
                  : undefined,
            }}
          >
            {(field) => {
              const showError =
                field.state.meta.isTouched || form.state.submissionAttempts > 0
              const invalid = showError && !field.state.meta.isValid

              return (
                <Field>
                  <FieldLabel htmlFor={field.name} required>
                    Confirm new password
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="new-password"
                    value={field.state.value}
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

          <form.Field name="revokeOtherSessions">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                  disabled={form.state.isSubmitting}
                />
                <FieldLabel htmlFor={field.name}>
                  Sign out other sessions
                </FieldLabel>
              </Field>
            )}
          </form.Field>
        </SectionContent>

        <SectionFooter>
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? "Changing…" : "Change password"}
              </Button>
            )}
          </form.Subscribe>
        </SectionFooter>
      </Section>
    </form>
  )
}
