import type {
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
} from "@alloy/api"
import { WEBHOOK_PROVIDERS, type WebhookProvider } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import type { ReactElement, ReactNode } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { AdminDialogFooter } from "./admin-dialog-footer"
import {
  setAdminWebhookCacheRow,
  WEBHOOK_PROVIDER_LABELS,
  WEBHOOK_URL_PLACEHOLDERS,
} from "./admin-webhook-data"

type CreateWebhookValues = {
  name: string
  provider: WebhookProvider
  url: string
  secret: string
}

const NEW_WEBHOOK: CreateWebhookValues = {
  name: "",
  provider: "discord",
  url: "",
  secret: "",
}

type EditWebhookValues = {
  name: string
  url: string
  secret: string
}

export function CreateWebhookDialog() {
  const [open, setOpen] = useState(false)

  return (
    <WebhookDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button" variant="secondary">
          <PlusIcon />
          {t("Add webhook")}
        </Button>
      }
      title={t("New webhook")}
      description={t(
        "Public clips are announced here as soon as they finish encoding.",
      )}
    >
      <CreateWebhookForm onSaved={() => setOpen(false)} />
    </WebhookDialog>
  )
}

/** Lives inside the dialog content, so closing the dialog discards the draft. */
function CreateWebhookForm({ onSaved }: { onSaved: () => void }) {
  const queryClient = useQueryClient()
  const { error, isPending, mutate } = useMutation({
    mutationFn: (input: AdminWebhookInput) => api.admin.createWebhook(input),
    onSuccess: (created) => {
      setAdminWebhookCacheRow(queryClient, created)
      onSaved()
    },
  })
  const form = useForm({
    defaultValues: NEW_WEBHOOK,
    onSubmit: ({ value }) => {
      if (isPending) return
      const input: AdminWebhookInput = {
        name: value.name.trim(),
        provider: value.provider,
        url: value.url.trim(),
      }
      if (value.provider === "generic" && value.secret) {
        input.secret = value.secret
      }
      mutate(input)
    },
  })
  const provider = useStore(form.store, (state) => state.values.provider)

  return (
    <WebhookForm
      form={form}
      isPending={isPending}
      error={error ? errorMessage(error, t("Couldn't create webhook")) : null}
    >
      <form.Field name="name">
        {(field) => (
          <WebhookNameField
            id="new-webhook-name"
            value={field.state.value}
            onValueChange={field.handleChange}
            placeholder={t("e.g. #clips")}
          />
        )}
      </form.Field>
      <form.Field name="provider">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="new-webhook-provider">
              {t("Provider")}
            </FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) => {
                if (
                  value === "discord" ||
                  value === "fluxer" ||
                  value === "generic"
                ) {
                  field.handleChange(value)
                }
              }}
            >
              <SelectTrigger id="new-webhook-provider" size="sm">
                <SelectValue>
                  {WEBHOOK_PROVIDER_LABELS[field.state.value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WEBHOOK_PROVIDERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {WEBHOOK_PROVIDER_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {field.state.value === "generic"
                ? t("Your endpoint receives a signed JSON payload.")
                : t("{provider} renders the clip link as a playable preview.", {
                    provider: WEBHOOK_PROVIDER_LABELS[field.state.value],
                  })}
            </FieldDescription>
          </Field>
        )}
      </form.Field>
      <form.Field name="url">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="new-webhook-url">
              {t("Endpoint URL")}
            </FieldLabel>
            <Input
              id="new-webhook-url"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={WEBHOOK_URL_PLACEHOLDERS[provider]}
              type="url"
              required
            />
          </Field>
        )}
      </form.Field>
      {provider === "generic" ? (
        <form.Field name="secret">
          {(field) => (
            <WebhookSecretField
              id="new-webhook-secret"
              value={field.state.value}
              onValueChange={field.handleChange}
              description={t(
                "Used to sign each payload so your endpoint can verify it.",
              )}
            />
          )}
        </form.Field>
      ) : null}
    </WebhookForm>
  )
}

export function EditWebhookDialog({
  webhook,
  open,
  onOpenChange: setOpen,
}: {
  webhook: AdminWebhookRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <WebhookDialog
      open={open}
      onOpenChange={setOpen}
      title={t("Edit webhook")}
      description={
        <>
          {WEBHOOK_PROVIDER_LABELS[webhook.provider]} · {webhook.url}
        </>
      }
    >
      <EditWebhookForm
        key={webhook.name}
        webhook={webhook}
        onSaved={() => setOpen(false)}
      />
    </WebhookDialog>
  )
}

function EditWebhookForm({
  webhook,
  onSaved,
}: {
  webhook: AdminWebhookRow
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const { error, isPending, mutate } = useMutation({
    mutationFn: (patch: AdminWebhookPatch) =>
      api.admin.updateWebhook(webhook.id, patch),
    onSuccess: (updated) => {
      setAdminWebhookCacheRow(queryClient, updated)
      onSaved()
    },
  })
  const form = useForm({
    // URL and secret start blank: the stored URL may be masked and the secret
    // is never sent back, so an empty field means "keep what is stored".
    defaultValues: {
      name: webhook.name,
      url: "",
      secret: "",
    } satisfies EditWebhookValues,
    onSubmit: ({ value }) => {
      if (isPending) return
      const patch: AdminWebhookPatch = { name: value.name.trim() }
      if (value.url.trim()) patch.url = value.url.trim()
      if (webhook.provider === "generic" && value.secret) {
        patch.secret = value.secret
      }
      mutate(patch)
    },
  })

  return (
    <WebhookForm
      form={form}
      isPending={isPending}
      error={error ? errorMessage(error, t("Couldn't save webhook")) : null}
    >
      <form.Field name="name">
        {(field) => (
          <WebhookNameField
            id="edit-webhook-name"
            value={field.state.value}
            onValueChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="url">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="edit-webhook-url">
              {t("Endpoint URL")}
            </FieldLabel>
            <Input
              id="edit-webhook-url"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              // The row does not show the stored URL and a phone hides the
              // dialog description, so the empty field is where it stays
              // visible.
              placeholder={webhook.url}
              type="url"
            />
            <FieldDescription>
              {t("Leave blank to keep the current URL.")}
            </FieldDescription>
          </Field>
        )}
      </form.Field>
      {webhook.provider === "generic" ? (
        <form.Field name="secret">
          {(field) => (
            <WebhookSecretField
              id="edit-webhook-secret"
              value={field.state.value}
              onValueChange={field.handleChange}
              description={
                webhook.secretSet
                  ? t("Leave blank to keep the current secret.")
                  : t(
                      "Used to sign each payload so your endpoint can verify it.",
                    )
              }
            />
          )}
        </form.Field>
      ) : null}
    </WebhookForm>
  )
}

function WebhookDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit when the opener lives elsewhere and drives `open` itself. */
  trigger?: ReactElement
  title: ReactNode
  description: ReactNode
  children: ReactNode
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <ResponsiveDialogTrigger render={trigger} /> : null}
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {children}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function WebhookForm({
  form,
  isPending,
  error,
  children,
}: {
  form: { handleSubmit: () => Promise<void> }
  isPending: boolean
  error: string | null
  children: ReactNode
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <ResponsiveDialogBody className="flex flex-col gap-4">
        {children}
        <FieldError>{error}</FieldError>
      </ResponsiveDialogBody>
      <AdminDialogFooter
        pending={isPending}
        failed={Boolean(error)}
        pendingLabel={t("Saving…")}
      >
        {t("Save")}
      </AdminDialogFooter>
    </form>
  )
}

function WebhookNameField({
  id,
  value,
  onValueChange,
  placeholder,
}: {
  id: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("Name")}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        maxLength={80}
        required
      />
    </Field>
  )
}

function WebhookSecretField({
  id,
  value,
  onValueChange,
  description,
}: {
  id: string
  value: string
  onValueChange: (value: string) => void
  description: ReactNode
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("Signing secret")}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        type="password"
        autoComplete="off"
        maxLength={200}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}
