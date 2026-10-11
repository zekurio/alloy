import type { AdminWebhookRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { List, ListItemButton } from "@alloy/ui/components/list"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SendIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { SettingsIntro } from "@/components/routes/settings/settings-panel"
import { adminKeys, adminWebhooksQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

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

  const body = isPending ? (
    <LoadingState variant="panel" />
  ) : (
    <div className="flex flex-col gap-4">
      <SettingsIntro action={<CreateWebhookDialog />}>
        {t(
          "Every public clip is announced once per webhook. Authors can opt out in their preferences.",
        )}
      </SettingsIntro>

      {error ? (
        <Callout tone="destructive">
          {errorMessage(error, t("Couldn't load webhooks"))}
        </Callout>
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

/**
 * The row opens the editor for the webhook's name and endpoint. The switch,
 * the test and delete act on the stored webhook right away, so they stay on
 * the row instead of behind the editor.
 */
function AdminWebhookListRow({ webhook }: { webhook: AdminWebhookRow }) {
  const queryClient = useQueryClient()
  const sendTestFeedback = useActionFeedback()
  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
    // Dropping the row from the cache unmounts it, and its dialogs with it.
    onSuccess: () => removeAdminWebhookCacheRow(queryClient, webhook.id),
  })
  const deleteError = remove.error
    ? errorMessage(remove.error, t("Couldn't delete webhook"))
    : null

  return (
    <>
      <ListItemButton
        onClick={() => setEditing(true)}
        actions={
          <>
            <Switch
              className="mr-1.5"
              checked={webhook.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={t("Enabled")}
            />
            <FeedbackButton
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Send test")}
              state={sendTestFeedback.feedback.state}
              pendingLabel={<span className="sr-only">{t("Sending...")}</span>}
              successLabel={
                <span className="sr-only">{t("Test delivered")}</span>
              }
              errorLabel={<span className="sr-only">{t("Try again")}</span>}
              onClick={() =>
                void sendTestFeedback.run(
                  () => sendTest.mutateAsync(),
                  t("Couldn't send test"),
                )
              }
            >
              <SendIcon />
            </FeedbackButton>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Delete webhook")}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon />
            </Button>
          </>
        }
      >
        <span
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-0.5",
            !webhook.enabled && "opacity-60",
          )}
        >
          <span className="text-md truncate font-semibold sm:text-base">
            {webhook.name}
          </span>
          <span className="text-foreground-dim truncate text-sm sm:text-xs">
            {WEBHOOK_PROVIDER_LABELS[webhook.provider]}
            {" · "}
            <WebhookDeliveryStatus webhook={webhook} />
          </span>
        </span>
      </ListItemButton>
      <EditWebhookDialog
        webhook={webhook}
        open={editing}
        onOpenChange={setEditing}
      />
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

function WebhookDeliveryStatus({ webhook }: { webhook: AdminWebhookRow }) {
  if (!webhook.enabled) return t("Paused")
  if (!webhook.lastDeliveryAt) return t("Never used")

  const time = formatRelativeTime(webhook.lastDeliveryAt)
  if (webhook.consecutiveFailures === 0) return t("Delivered {time}", { time })

  return (
    <span
      className="text-destructive"
      title={webhook.lastDeliveryError ?? undefined}
    >
      {t("Failing since {time}", { time })}
    </span>
  )
}
