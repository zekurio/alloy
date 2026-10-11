import type { AdminWebhookRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { List, ListItemButton } from "@alloy/ui/components/list"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { SettingsIntro } from "@/components/routes/settings/settings-panel"
import { adminWebhooksQueryOptions } from "@/lib/admin-query-keys"
import { formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"

import { WEBHOOK_PROVIDER_LABELS } from "./admin-webhook-data"
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
 * The row names the webhook and says how it is doing; everything you can do to
 * it lives in the editor the row opens, so the name keeps the full width.
 */
function AdminWebhookListRow({ webhook }: { webhook: AdminWebhookRow }) {
  const [editing, setEditing] = useState(false)

  return (
    <>
      <ListItemButton onClick={() => setEditing(true)}>
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
