import type { AdminWebhookRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { List, ListItem } from "@alloy/ui/components/list"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SendIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { adminKeys, adminWebhooksQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"

import {
  removeAdminWebhookCacheRow,
  setAdminWebhookCacheRow,
  WEBHOOK_PROVIDER_LABELS,
} from "./admin-webhook-data"
import { CreateWebhookDialog, EditWebhookDialog } from "./admin-webhook-dialogs"

export function AdminWebhooksCard({ hideHeader }: { hideHeader?: boolean }) {
  const {
    data: webhooks,
    isPending,
    error,
  } = useQuery(adminWebhooksQueryOptions())

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-foreground-muted text-sm">
          {t(
            "Every public clip is announced once per webhook. Authors can opt out in their preferences.",
          )}
        </p>
        <CreateWebhookDialog />
      </div>

      {error ? (
        <Callout tone="destructive">
          {errorMessage(error, t("Couldn't load webhooks"))}
        </Callout>
      ) : isPending ? (
        <Spinner className="size-5" />
      ) : webhooks.length === 0 ? (
        <ListEmpty title={t("No webhooks yet")} />
      ) : (
        <List>
          {webhooks.map((webhook) => (
            <AdminWebhookListRow key={webhook.id} webhook={webhook} />
          ))}
        </List>
      )}
    </div>
  )

  if (hideHeader) return body

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Webhooks")}</SectionTitle>
      </SectionHeader>
      <SectionContent>{body}</SectionContent>
    </Section>
  )
}

function AdminWebhookListRow({ webhook }: { webhook: AdminWebhookRow }) {
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.admin.updateWebhook(webhook.id, { enabled }),
    onSuccess: (updated) => setAdminWebhookCacheRow(queryClient, updated),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update webhook"))),
  })

  const sendTest = useMutation({
    mutationFn: () => api.admin.testWebhook(webhook.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.webhooks() })
      if (result.ok) {
        toast.success(t("Test delivered"))
        return
      }
      toast.error(result.error ?? t("Couldn't send test"))
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't send test"))),
  })

  const remove = useMutation({
    mutationFn: () => api.admin.deleteWebhook(webhook.id),
    onSuccess: () => {
      removeAdminWebhookCacheRow(queryClient, webhook.id)
      toast.success(t("Webhook deleted"))
      setDeleteOpen(false)
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't delete webhook"))),
  })

  return (
    <ListItem className="items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{webhook.name}</span>
        <span className="text-foreground-muted truncate text-xs">
          {webhook.url}
        </span>
      </div>
      <Badge
        variant={webhook.provider === "discord" ? "accent" : "secondary"}
        size="text"
      >
        {WEBHOOK_PROVIDER_LABELS[webhook.provider]}
      </Badge>
      <WebhookDeliveryStatus webhook={webhook} />
      <Switch
        checked={webhook.enabled}
        disabled={toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
        aria-label={t("Enable webhook")}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("Send test")}
        disabled={sendTest.isPending}
        onClick={() => sendTest.mutate()}
      >
        {sendTest.isPending ? <Spinner className="size-4" /> : <SendIcon />}
      </Button>
      <EditWebhookDialog webhook={webhook} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("Delete webhook")}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2Icon />
      </Button>
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("Delete this webhook?")}
        description={t(
          "It stops receiving announcements. Clips it already received are not re-sent if you add it back.",
        )}
        confirmLabel={t("Delete")}
        pendingLabel={t("Deleting")}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </ListItem>
  )
}

function WebhookDeliveryStatus({ webhook }: { webhook: AdminWebhookRow }) {
  if (!webhook.lastDeliveryAt) {
    return (
      <span className="text-foreground-faint hidden text-xs sm:inline">
        {t("Never used")}
      </span>
    )
  }

  const failing = webhook.consecutiveFailures > 0
  return (
    <span
      className={
        failing
          ? "text-destructive hidden text-xs sm:inline"
          : "text-foreground-muted hidden text-xs sm:inline"
      }
      title={webhook.lastDeliveryError ?? undefined}
    >
      {failing
        ? t("Failing since {time}", {
            time: formatRelativeTime(webhook.lastDeliveryAt),
          })
        : formatRelativeTime(webhook.lastDeliveryAt)}
    </span>
  )
}
