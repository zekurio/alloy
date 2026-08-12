import { createFileRoute } from "@tanstack/react-router"

import { NotificationsPage } from "@/components/notifications/notification-bell"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/notifications")({
  beforeLoad: async ({ context }) => {
    await requireStrictAuthBeforeLoad({ context })
  },
  component: NotificationsPage,
})
