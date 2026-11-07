import type { PublicAuthConfig } from "@alloy/api"
import type { LinkedAccount } from "@alloy/api/auth"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { List, ListItem } from "@alloy/ui/components/list"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import {
  CircleAlertIcon,
  Link2OffIcon,
  LinkIcon,
  UserKeyIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient, useSession } from "@/lib/auth-client"
import {
  authCallbackUrl,
  isAuthAttemptCancellation,
  reportAuthFlowFailure,
} from "@/lib/auth-flow"
import { authKeys } from "@/lib/auth-query-keys"
import {
  consumeCurrentQueryParam,
  currentUrlWithQueryParam,
} from "@/lib/browser-url"
import { errorMessage } from "@/lib/error-message"
import { refreshAfterWrite } from "@/lib/refresh-after-write"

export type { LinkedAccount }

const OAUTH_LINKED_QUERY_KEY = "oauthLinked"
/** Error target of a failed link, which has no account row yet. */
const LINK_TARGET = "link"

export function shouldShowLinkedAccountsCard(
  config: PublicAuthConfig,
  accounts: LinkedAccount[],
): boolean {
  return config.oidc !== null || accounts.length > 0
}

export function LinkedAccountsCard({
  accounts,
  config,
  hasPasskeySignIn,
  onRefresh,
}: {
  accounts: LinkedAccount[]
  config: PublicAuthConfig
  hasPasskeySignIn: boolean
  onRefresh: () => Promise<void>
}) {
  const router = useRouter()
  const actions = useLinkedAccountActions({
    accounts,
    config,
    hasPasskeySignIn,
    refresh: onRefresh,
    router,
  })

  return (
    <SettingsSubsection
      id="linked-accounts"
      title={t("Linked accounts")}
      description={t("Connect additional sign-in methods to your account.")}
    >
      {actions.actionError ? (
        <Callout tone="destructive" className="mb-3">
          <CircleAlertIcon />
          <span>{actions.actionError.message}</span>
        </Callout>
      ) : null}
      <AccountsList
        accounts={accounts}
        config={config}
        hasPasskeySignIn={hasPasskeySignIn}
        linking={actions.linking}
        unlinkingId={actions.unlinkingId}
        actionErrorTarget={actions.actionError?.target ?? null}
        onLink={actions.onLink}
        onUnlink={actions.onUnlink}
      />
    </SettingsSubsection>
  )
}

function useLinkedAccountActions({
  accounts,
  config,
  hasPasskeySignIn,
  refresh,
  router,
}: {
  accounts: LinkedAccount[]
  config: PublicAuthConfig
  hasPasskeySignIn: boolean
  refresh: () => Promise<void>
  router: ReturnType<typeof useRouter>
}) {
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    if (consumeCurrentQueryParam(OAUTH_LINKED_QUERY_KEY) !== "1") return

    let active = true

    void (async () => {
      try {
        await refresh()
        await refetchSession({ query: { disableCookieCache: true } })
        await router.invalidate()
      } catch (cause) {
        if (active) {
          setRefreshError(
            errorMessage(cause, t("Couldn't refresh linked accounts")),
          )
        }
      }
    })()

    return () => {
      active = false
    }
  }, [refetchSession, refresh, router])

  const link = useMutation({
    mutationFn: async () => {
      try {
        const { error } = await authClient.oauth2.link({
          callbackURL:
            currentUrlWithQueryParam(OAUTH_LINKED_QUERY_KEY, "1") ??
            authCallbackUrl(`/?settings=profile&${OAUTH_LINKED_QUERY_KEY}=1`),
        })
        if (error) throw error
      } catch (cause) {
        reportAuthFlowFailure(
          "OAuth link",
          t("Couldn't start link flow"),
          cause,
        )
        throw new Error(
          isAuthAttemptCancellation(cause)
            ? t("Auth attempt cancelled.")
            : errorMessage(cause, t("Couldn't start link flow")),
        )
      }
    },
  })

  const unlink = useMutation({
    mutationFn: async (account: LinkedAccount) => {
      if (!canRemoveAccount(account, accounts, config, hasPasskeySignIn)) {
        throw new Error(
          t(
            "This is your last enabled sign-in method. Link another before removing it.",
          ),
        )
      }
      const { error } = await authClient.unlinkAccount({
        accountId: account.accountId,
      })
      if (error) throw new Error(errorMessage(error, t("Couldn't unlink")))
      // The unlink saved; drop the row now and let the refetch catch up
      // without turning a refresh failure into "Couldn't unlink".
      queryClient.setQueryData<LinkedAccount[]>(
        authKeys.accounts(),
        (current) => current?.filter((entry) => entry.id !== account.id),
      )
      void refreshAfterWrite("linked accounts", async () => {
        await refresh()
        await router.invalidate()
      })
    },
  })

  // A successful link stays busy: the page is about to leave for the provider.
  const linking = link.isPending || link.isSuccess

  // One error slot: starting either action clears the other's failure.
  const actionError = link.error
    ? { target: LINK_TARGET, message: link.error.message }
    : unlink.error
      ? {
          target: unlink.variables?.id ?? "",
          message: errorMessage(unlink.error, t("Couldn't unlink")),
        }
      : refreshError
        ? { target: "refresh", message: refreshError }
        : null

  return {
    linking,
    unlinkingId: unlink.isPending ? unlink.variables.id : null,
    actionError,
    onLink: () => {
      if (linking) return
      unlink.reset()
      setRefreshError(null)
      link.mutate()
    },
    onUnlink: (account: LinkedAccount) => {
      if (unlink.isPending) return
      link.reset()
      setRefreshError(null)
      unlink.mutate(account)
    },
  }
}

type AccountsListProps = {
  accounts: LinkedAccount[]
  config: PublicAuthConfig
  hasPasskeySignIn: boolean
  linking: boolean
  unlinkingId: string | null
  actionErrorTarget: string | null
  onLink: () => void
  onUnlink: (account: LinkedAccount) => void
}

function AccountsList({
  accounts,
  config,
  hasPasskeySignIn,
  linking,
  unlinkingId,
  actionErrorTarget,
  onLink,
  onUnlink,
}: AccountsListProps) {
  const { oidc } = config

  return (
    <List>
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          label={oidc?.displayName ?? t("Single sign-on")}
          sublabel={
            oidc
              ? linkedAccountLabel(account)
              : t("{label} · No longer configured", {
                  label: linkedAccountLabel(account),
                })
          }
          busy={unlinkingId === account.id}
          failed={actionErrorTarget === account.id}
          canUnlink={canRemoveAccount(
            account,
            accounts,
            config,
            hasPasskeySignIn,
          )}
          onAction={() => onUnlink(account)}
        />
      ))}

      {oidc && accounts.length === 0 ? (
        <LinkRow
          label={oidc.displayName}
          busy={linking}
          failed={actionErrorTarget === LINK_TARGET}
          onLink={onLink}
        />
      ) : null}
    </List>
  )
}

function linkedAccountLabel(account: LinkedAccount): string {
  return account.accountLabel
    ? t("Connected as {label}", { label: account.accountLabel })
    : t("Connected")
}

function LinkRow(props: {
  label: string
  busy: boolean
  failed: boolean
  onLink: () => void
}) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon />
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-foreground-dim text-xs">{t("Not linked")}</p>
        </div>
      </div>
      <FeedbackButton
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        disabled={props.busy}
        state={props.busy ? "pending" : props.failed ? "error" : "idle"}
        pendingLabel={t("Redirecting…")}
        errorLabel={t("Try again")}
        onClick={props.onLink}
      >
        <LinkIcon />
        {t("Link")}
      </FeedbackButton>
    </ListItem>
  )
}

type AccountRowProps = {
  label: string
  sublabel: string
  busy: boolean
  failed: boolean
  canUnlink: boolean
  onAction: () => void
}

function AccountRow(props: AccountRowProps) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon />
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-foreground-dim text-xs">{props.sublabel}</p>
        </div>
      </div>
      <FeedbackButton
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        disabled={props.busy || !props.canUnlink}
        state={props.busy ? "pending" : props.failed ? "error" : "idle"}
        pendingLabel={t("Removing…")}
        errorLabel={t("Try again")}
        onClick={props.onAction}
        title={
          props.canUnlink
            ? undefined
            : t("Link another enabled sign-in method before removing this one")
        }
      >
        <Link2OffIcon />
        {t("Unlink")}
      </FeedbackButton>
    </ListItem>
  )
}

function ProviderIcon() {
  return (
    <span className="border-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border">
      <UserKeyIcon className="size-4" />
    </span>
  )
}

function canRemoveAccount(
  target: LinkedAccount,
  accounts: LinkedAccount[],
  config: PublicAuthConfig,
  hasPasskeySignIn: boolean,
): boolean {
  if (hasPasskeySignIn) return true
  // Another linked account keeps a way in only while SSO is on.
  return (
    config.oidc !== null && accounts.some((account) => account.id !== target.id)
  )
}
