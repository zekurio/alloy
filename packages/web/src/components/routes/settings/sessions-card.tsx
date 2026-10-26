import type { AuthSessionSummary } from "@alloy/api/auth"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { List, ListItem } from "@alloy/ui/components/list"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  GlobeIcon,
  LogOutIcon,
  MonitorIcon,
  SmartphoneIcon,
} from "lucide-react"
import { useState } from "react"

import { LoadErrorCallout } from "@/components/routes/load-error"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient } from "@/lib/auth-client"
import { authKeys, sessionsQueryOptions } from "@/lib/auth-query-keys"
import {
  dateTime,
  formatCalendarDate,
  formatRelativeTime,
} from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"

// The server moves a session's last-seen time at most hourly, so anything
// more recent than that only says "within the last hour".
const LAST_SEEN_PRECISION_MS = 60 * 60 * 1000

export function SessionsCard() {
  const queryClient = useQueryClient()
  const sessionsQuery = useQuery(sessionsQueryOptions())
  const [sessionToRevoke, setSessionToRevoke] = useState<string | null>(null)
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false)

  const invalidateSessions = () =>
    queryClient.invalidateQueries({ queryKey: authKeys.sessions() })

  const revokeSession = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await authClient.revokeSession({ id })
      if (error) {
        throw new Error(errorMessage(error, t("Couldn't sign out session")))
      }
    },
    onSuccess: () => setSessionToRevoke(null),
    onSettled: invalidateSessions,
  })

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.revokeOtherSessions()
      if (error) {
        throw new Error(
          errorMessage(error, t("Couldn't sign out other sessions")),
        )
      }
    },
    onSuccess: () => setRevokeOthersOpen(false),
    onSettled: invalidateSessions,
  })

  const sessions = sessionsQuery.data
  if (!sessions && sessionsQuery.isPending) return null

  const hasOtherSessions = sessions?.some((session) => !session.current)
  const now = Date.now()

  return (
    <SettingsSubsection
      id="sessions"
      title={t("Sessions")}
      description={t("Browsers and desktop apps signed in to your account.")}
      action={
        hasOtherSessions ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              revokeOthers.reset()
              setRevokeOthersOpen(true)
            }}
          >
            <LogOutIcon />
            {t("Sign out other sessions")}
          </Button>
        ) : null
      }
    >
      {sessions ? (
        <>
          {sessions.length > 0 ? (
            <List>
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  now={now}
                  onSignOut={() => {
                    revokeSession.reset()
                    setSessionToRevoke(session.id)
                  }}
                />
              ))}
            </List>
          ) : null}
          {hasOtherSessions ? null : (
            <p className="text-foreground-dim text-xs">
              {t("You're not signed in anywhere else.")}
            </p>
          )}
        </>
      ) : (
        <LoadErrorCallout
          message={errorMessage(
            sessionsQuery.error,
            t("Couldn't load sessions"),
          )}
          onRetry={() => void sessionsQuery.refetch()}
        />
      )}
      <ConfirmActionDialog
        open={sessionToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokeSession.isPending) setSessionToRevoke(null)
        }}
        title={t("Sign out this session?")}
        description={t("That device will need to sign in again.")}
        confirmLabel={t("Sign out")}
        pendingLabel={t("Signing out…")}
        pending={revokeSession.isPending}
        error={revokeSession.error?.message}
        confirmVariant="destructive"
        onConfirm={() => {
          if (sessionToRevoke !== null) revokeSession.mutate(sessionToRevoke)
        }}
      />
      <ConfirmActionDialog
        open={revokeOthersOpen}
        onOpenChange={(open) => {
          if (!open && !revokeOthers.isPending) setRevokeOthersOpen(false)
        }}
        title={t("Sign out of all other sessions?")}
        description={t(
          "Every other browser and desktop app will need to sign in again.",
        )}
        confirmLabel={t("Sign out others")}
        pendingLabel={t("Signing out…")}
        pending={revokeOthers.isPending}
        error={revokeOthers.error?.message}
        confirmVariant="destructive"
        onConfirm={() => revokeOthers.mutate()}
      />
    </SettingsSubsection>
  )
}

function SessionRow({
  session,
  now,
  onSignOut,
}: {
  session: AuthSessionSummary
  now: number
  onSignOut: () => void
}) {
  const Icon =
    session.clientKind === "desktop"
      ? MonitorIcon
      : session.os === "Android" || session.os === "iOS"
        ? SmartphoneIcon
        : GlobeIcon
  const details = [
    session.clientKind === "desktop" ? t("Desktop app") : null,
    sessionActivity(session, now),
    session.ipAddress,
  ].filter((detail) => detail !== null)

  return (
    <ListItem>
      <span className="border-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {sessionTitle(session)}
          </span>
          {session.current ? (
            <Badge variant="accent" size="text" className="shrink-0">
              {t("This device")}
            </Badge>
          ) : null}
        </div>
        <p
          className="text-foreground-dim truncate text-xs"
          title={t("Signed in {date}", {
            date: formatCalendarDate(session.createdAt),
          })}
        >
          {details.join(" · ")}
        </p>
      </div>
      {session.current ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("Sign out this session")}
          title={t("Sign out this session")}
          onClick={onSignOut}
        >
          <LogOutIcon className="size-3.5" />
        </Button>
      )}
    </ListItem>
  )
}

function sessionTitle(session: AuthSessionSummary): string {
  if (session.clientKind === "desktop") {
    return session.deviceName ?? t("Alloy Desktop")
  }
  if (session.browser && session.os) {
    return t("{browser} on {os}", { browser: session.browser, os: session.os })
  }
  return session.browser ?? session.os ?? t("Unknown browser")
}

function sessionActivity(session: AuthSessionSummary, now: number): string {
  if (session.current) return t("Active now")
  const lastSeen = dateTime(session.lastSeenAt)
  if (lastSeen !== null && now - lastSeen < LAST_SEEN_PRECISION_MS) {
    return t("Active within the last hour")
  }
  return t("Last active {time}", {
    time: formatRelativeTime(session.lastSeenAt, now),
  })
}
