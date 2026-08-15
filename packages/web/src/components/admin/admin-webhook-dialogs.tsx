import type {
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
} from "@alloy/api"
import { WEBHOOK_PROVIDERS, type WebhookProvider } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
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
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
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
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import {
  setAdminWebhookCacheRow,
  WEBHOOK_PROVIDER_LABELS,
  WEBHOOK_URL_PLACEHOLDERS,
} from "./admin-webhook-data"

export function CreateWebhookDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [provider, setProvider] = useState<WebhookProvider>("discord")
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")

  useEffect(() => {
    if (open) return
    setName("")
    setProvider("discord")
    setUrl("")
    setSecret("")
  }, [open])

  const { error, isPending, mutate } = useMutation({
    mutationFn: () => {
      const input: AdminWebhookInput = {
        name: name.trim(),
        provider,
        url: url.trim(),
      }
      if (provider === "generic" && secret) input.secret = secret
      return api.admin.createWebhook(input)
    },
    onSuccess: (created) => {
      setAdminWebhookCacheRow(queryClient, created)
      setOpen(false)
    },
  })
  const submitError = error
    ? errorMessage(error, t("Couldn't create webhook"))
    : null

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (isPending) return
    mutate()
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button type="button" size="icon" aria-label={t("Add webhook")}>
            <PlusIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("New webhook")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t(
              "Public clips are announced here as soon as they finish encoding.",
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <WebhookNameField
              id="new-webhook-name"
              value={name}
              onValueChange={setName}
              placeholder={t("e.g. #clips")}
            />
            <Field>
              <FieldLabel htmlFor="new-webhook-provider">
                {t("Provider")}
              </FieldLabel>
              <Select
                value={provider}
                onValueChange={(value) => {
                  if (value === "discord" || value === "generic") {
                    setProvider(value)
                  }
                }}
              >
                <SelectTrigger id="new-webhook-provider" size="sm">
                  <SelectValue>{WEBHOOK_PROVIDER_LABELS[provider]}</SelectValue>
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
                {provider === "discord"
                  ? t("Discord renders the clip link as a playable preview.")
                  : t("Your endpoint receives a signed JSON payload.")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-webhook-url">
                {t("Endpoint URL")}
              </FieldLabel>
              <Input
                id="new-webhook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={WEBHOOK_URL_PLACEHOLDERS[provider]}
                type="url"
                required
              />
            </Field>
            {provider === "generic" ? (
              <WebhookSecretField
                id="new-webhook-secret"
                value={secret}
                onValueChange={setSecret}
                description={t(
                  "Used to sign each payload so your endpoint can verify it.",
                )}
              />
            ) : null}
            <FieldError>{submitError}</FieldError>
          </ResponsiveDialogBody>
          <WebhookDialogFooter isPending={isPending} error={submitError} />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function EditWebhookDialog({ webhook }: { webhook: AdminWebhookRow }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(webhook.name)
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState("")

  useEffect(() => {
    if (!open) return
    setName(webhook.name)
    // Both start blank: the stored URL may be masked and the secret is never
    // sent back, so an empty field means "keep what is stored".
    setUrl("")
    setSecret("")
  }, [open, webhook.name])

  const { error, isPending, mutate } = useMutation({
    mutationFn: () => {
      const patch: AdminWebhookPatch = { name: name.trim() }
      if (url.trim()) patch.url = url.trim()
      if (webhook.provider === "generic" && secret) patch.secret = secret
      return api.admin.updateWebhook(webhook.id, patch)
    },
    onSuccess: (updated) => {
      setAdminWebhookCacheRow(queryClient, updated)
      setOpen(false)
    },
  })
  const submitError = error
    ? errorMessage(error, t("Couldn't save webhook"))
    : null

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (isPending) return
    mutate()
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Edit webhook")}
          >
            <PencilIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("Edit webhook")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {WEBHOOK_PROVIDER_LABELS[webhook.provider]} · {webhook.url}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <WebhookNameField
              id="edit-webhook-name"
              value={name}
              onValueChange={setName}
            />
            <Field>
              <FieldLabel htmlFor="edit-webhook-url">
                {t("Endpoint URL")}
              </FieldLabel>
              <Input
                id="edit-webhook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={WEBHOOK_URL_PLACEHOLDERS[webhook.provider]}
                type="url"
              />
              <FieldDescription>
                {t("Leave blank to keep the current URL.")}
              </FieldDescription>
            </Field>
            {webhook.provider === "generic" ? (
              <WebhookSecretField
                id="edit-webhook-secret"
                value={secret}
                onValueChange={setSecret}
                description={
                  webhook.secretSet
                    ? t("Leave blank to keep the current secret.")
                    : t(
                        "Used to sign each payload so your endpoint can verify it.",
                      )
                }
              />
            ) : null}
            <FieldError>{submitError}</FieldError>
          </ResponsiveDialogBody>
          <WebhookDialogFooter isPending={isPending} error={submitError} />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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

function WebhookDialogFooter({
  isPending,
  error,
}: {
  isPending: boolean
  error: string | null
}) {
  return (
    <ResponsiveDialogFooter>
      <ResponsiveDialogClose
        render={<Button type="button" variant="ghost" disabled={isPending} />}
      >
        {t("Cancel")}
      </ResponsiveDialogClose>
      <FeedbackButton
        type="submit"
        variant="primary"
        size="sm"
        state={isPending ? "pending" : error ? "error" : "idle"}
        pendingLabel={t("Saving…")}
        errorLabel={t("Try again")}
        disabled={isPending}
      >
        {t("Save")}
      </FeedbackButton>
    </ResponsiveDialogFooter>
  )
}
