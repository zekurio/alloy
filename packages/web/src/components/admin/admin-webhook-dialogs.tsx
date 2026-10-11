import type {
  AdminWebhookInput,
  AdminWebhookPatch,
  AdminWebhookRow,
} from "@alloy/api"
import { WEBHOOK_PROVIDERS, type WebhookProvider } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import { List, ListItem, ListItemButton } from "@alloy/ui/components/list"
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
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleAlertIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent, ReactElement, ReactNode } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

import {
  removeAdminWebhookCacheRow,
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
    <WebhookDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button">
          <PlusIcon />
          {t("Add webhook")}
        </Button>
      }
      title={t("New webhook")}
      description={t(
        "Public clips are announced here as soon as they finish encoding.",
      )}
      onSubmit={handleSubmit}
      isPending={isPending}
      error={submitError}
    >
      <WebhookNameField
        id="new-webhook-name"
        value={name}
        onValueChange={setName}
        placeholder={t("e.g. #clips")}
      />
      <Field>
        <FieldLabel htmlFor="new-webhook-provider">{t("Provider")}</FieldLabel>
        <Select
          value={provider}
          onValueChange={(value) => {
            if (
              value === "discord" ||
              value === "fluxer" ||
              value === "generic"
            ) {
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
          {provider === "generic"
            ? t("Your endpoint receives a signed JSON payload.")
            : t("{provider} renders the clip link as a playable preview.", {
                provider: WEBHOOK_PROVIDER_LABELS[provider],
              })}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="new-webhook-url">{t("Endpoint URL")}</FieldLabel>
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
    </WebhookDialog>
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
  const queryClient = useQueryClient()
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
    <WebhookDialog
      open={open}
      onOpenChange={setOpen}
      title={t("Edit webhook")}
      description={
        <>
          {WEBHOOK_PROVIDER_LABELS[webhook.provider]} · {webhook.url}
        </>
      }
      onSubmit={handleSubmit}
      isPending={isPending}
      error={submitError}
    >
      <WebhookNameField
        id="edit-webhook-name"
        value={name}
        onValueChange={setName}
      />
      <Field>
        <FieldLabel htmlFor="edit-webhook-url">{t("Endpoint URL")}</FieldLabel>
        <Input
          id="edit-webhook-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          // The row no longer shows the stored URL and a phone hides the
          // dialog description, so the empty field is where it stays visible.
          placeholder={webhook.url}
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
              : t("Used to sign each payload so your endpoint can verify it.")
          }
        />
      ) : null}
      <WebhookActions webhook={webhook} />
    </WebhookDialog>
  )
}

/**
 * What the list row used to carry. These act on the stored webhook right away
 * and are independent of the form's Save.
 */
function WebhookActions({ webhook }: { webhook: AdminWebhookRow }) {
  const queryClient = useQueryClient()
  const sendTestFeedback = useActionFeedback()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const enabledId = `edit-webhook-enabled-${webhook.id}`

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.admin.updateWebhook(webhook.id, { enabled }),
    onSuccess: (updated) => setAdminWebhookCacheRow(queryClient, updated),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update webhook"))),
  })

  const sendTest = useMutation({
    mutationFn: async () => {
      const result = await api.admin.testWebhook(webhook.id)
      if (!result.ok) throw new Error(result.error ?? t("Couldn't send test"))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.webhooks() })
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't send test"))),
  })

  const remove = useMutation({
    mutationFn: () => api.admin.deleteWebhook(webhook.id),
    // Dropping the row from the cache unmounts it, and this editor with it.
    onSuccess: () => removeAdminWebhookCacheRow(queryClient, webhook.id),
  })
  const deleteError = remove.error
    ? errorMessage(remove.error, t("Couldn't delete webhook"))
    : null

  const testState = sendTestFeedback.feedback.state

  return (
    <>
      <List>
        <ListItem className="min-h-12 py-2">
          <label
            htmlFor={enabledId}
            className="min-w-0 flex-1 text-base font-medium"
          >
            {t("Enabled")}
          </label>
          <Switch
            id={enabledId}
            checked={webhook.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
          />
        </ListItem>
        <ListItemButton
          className="min-h-12 py-2"
          aria-live="polite"
          disabled={testState === "pending" || testState === "success"}
          trailing={
            testState === "pending" ? (
              <Spinner />
            ) : testState === "success" ? (
              <CheckIcon className="text-success size-4 shrink-0" />
            ) : testState === "error" ? (
              <CircleAlertIcon className="text-destructive size-4 shrink-0" />
            ) : (
              <SendIcon className="text-foreground-muted size-4 shrink-0" />
            )
          }
          onClick={() =>
            void sendTestFeedback.run(
              () => sendTest.mutateAsync(),
              t("Couldn't send test"),
            )
          }
        >
          <span className="min-w-0 flex-1 text-base font-medium">
            {testState === "pending"
              ? t("Sending...")
              : testState === "success"
                ? t("Test delivered")
                : testState === "error"
                  ? t("Try again")
                  : t("Send test")}
          </span>
        </ListItemButton>
        <ListItemButton
          className="text-danger min-h-12 py-2"
          trailing={<Trash2Icon className="size-4 shrink-0" />}
          onClick={() => setDeleteOpen(true)}
        >
          <span className="min-w-0 flex-1 text-base font-medium">
            {t("Delete webhook")}
          </span>
        </ListItemButton>
      </List>
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) remove.reset()
        }}
        title={t("Delete this webhook?")}
        description={t(
          "It stops receiving announcements. Clips it already received are not re-sent if you add it back.",
        )}
        confirmLabel={t("Delete")}
        pendingLabel={t("Deleting")}
        pending={remove.isPending}
        error={deleteError}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

function WebhookDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  onSubmit,
  isPending,
  error,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit when the opener lives elsewhere and drives `open` itself. */
  trigger?: ReactElement
  title: ReactNode
  description: ReactNode
  onSubmit: (event: FormEvent) => void
  isPending: boolean
  error: string | null
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
        <form onSubmit={onSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            {children}
            <FieldError>{error}</FieldError>
          </ResponsiveDialogBody>
          <WebhookDialogFooter isPending={isPending} error={error} />
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
