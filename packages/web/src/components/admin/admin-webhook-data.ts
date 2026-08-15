import type { AdminWebhookRow } from "@alloy/api"
import type { WebhookProvider } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import type { QueryClient } from "@tanstack/react-query"

import { adminKeys } from "@/lib/admin-query-keys"

export const WEBHOOK_PROVIDER_LABELS = {
  discord: t("Discord"),
  generic: t("Generic"),
} satisfies Record<WebhookProvider, string>

export const WEBHOOK_URL_PLACEHOLDERS = {
  discord: "https://discord.com/api/webhooks/…",
  generic: "https://example.com/hooks/alloy",
} satisfies Record<WebhookProvider, string>

export function setAdminWebhookCacheRow(
  queryClient: QueryClient,
  webhook: AdminWebhookRow,
): void {
  queryClient.setQueryData<AdminWebhookRow[]>(adminKeys.webhooks(), (old) => {
    if (!old) return [webhook]
    return old.some((item) => item.id === webhook.id)
      ? old.map((item) => (item.id === webhook.id ? webhook : item))
      : [webhook, ...old]
  })
}

export function removeAdminWebhookCacheRow(
  queryClient: QueryClient,
  webhookId: string,
): void {
  queryClient.setQueryData<AdminWebhookRow[]>(adminKeys.webhooks(), (old) =>
    old?.filter((webhook) => webhook.id !== webhookId),
  )
}
