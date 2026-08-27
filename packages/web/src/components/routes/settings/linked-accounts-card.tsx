import type { PublicAuthConfig } from "@alloy/api"
import type { LinkedAccount } from "@alloy/api/auth"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { List, ListItem } from "@alloy/ui/components/list"
import { useRouter } from "@tanstack/react-router"
import {
  CircleAlertIcon,
  Link2OffIcon,
  LinkIcon,
  UserKeyIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { authClient, useSession } from "@/lib/auth-client"
import {
  authCallbackUrl,
  isAuthAttemptCancellation,
  reportAuthFlowFailure,
} from "@/lib/auth-flow"
import { consumeCurrentQueryParam } from "@/lib/browser-url"
import { errorMessage } from "@/lib/error-message"

export type { LinkedAccount }

type Provider = PublicAuthConfig["providers"][number]
const OAUTH_LINKED_QUERY_KEY = "oauthLinked"

export function shouldShowLinkedAccountsCard(
  config: PublicAuthConfig,
  accounts: LinkedAccount[],
): boolean {
  if (config.providers.length > 0) return true
  return accounts.some((account) => account.providerId !== "credential")
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
        linkingProviderId={actions.linkingProviderId}
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
  const { refetch: refetchSession } = useSession()
  const [linkingProviderId, setLinkingProviderId] = useState<string | null>(
    null,
  )
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{
    target: string
    message: string
  } | null>(null)

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
          setActionError({
            target: "refresh",
            message: errorMessage(cause, t("Couldn't refresh linked accounts")),
          })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [refetchSession, refresh, router])

  const onLink = useCallback(
    async (provider: Provider) => {
      if (linkingProviderId) return
      setActionError(null)
      setLinkingProviderId(provider.providerId)
      try {
        const { error } = await authClient.oauth2.link({
          providerId: provider.providerId,
          callbackURL: authCallbackUrl(`/settings?${OAUTH_LINKED_QUERY_KEY}=1`),
        })
        if (error) {
          reportAuthFlowFailure(
            "OAuth link",
            t("Couldn't start link flow"),
            error,
          )
          setActionError({
            target: provider.providerId,
            message: isAuthAttemptCancellation(error)
              ? t("Auth attempt cancelled.")
              : errorMessage(error, t("Couldn't start link flow")),
          })
          setLinkingProviderId(null)
        }
      } catch (cause) {
        reportAuthFlowFailure(
          "OAuth link",
          t("Couldn't start link flow"),
          cause,
        )
        setActionError({
          target: provider.providerId,
          message: isAuthAttemptCancellation(cause)
            ? t("Auth attempt cancelled.")
            : errorMessage(cause, t("Couldn't start link flow")),
        })
        setLinkingProviderId(null)
      }
    },
    [linkingProviderId],
  )

  const onUnlink = useCallback(
    async (account: LinkedAccount) => {
      if (unlinkingId) return
      if (!canRemoveAccount(account, accounts, config, hasPasskeySignIn)) {
        setActionError({
          target: account.id,
          message: t(
            "This is your last enabled sign-in method. Link another before removing it.",
          ),
        })
        return
      }
      setActionError(null)
      setUnlinkingId(account.id)
      try {
        const { error } = await authClient.unlinkAccount({
          providerId: account.providerId,
          accountId: account.accountId,
        })
        if (error) {
          setActionError({
            target: account.id,
            message: errorMessage(error, t("Couldn't unlink")),
          })
          return
        }
        await refresh()
        await router.invalidate()
      } catch (cause) {
        setActionError({
          target: account.id,
          message: errorMessage(cause, t("Couldn't unlink")),
        })
      } finally {
        setUnlinkingId(null)
      }
    },
    [accounts, config, hasPasskeySignIn, refresh, router, unlinkingId],
  )

  return {
    linkingProviderId,
    unlinkingId,
    actionError,
    onLink,
    onUnlink,
  }
}

type AccountsListProps = {
  accounts: LinkedAccount[]
  config: PublicAuthConfig
  hasPasskeySignIn: boolean
  linkingProviderId: string | null
  unlinkingId: string | null
  actionErrorTarget: string | null
  onLink: (provider: Provider) => void
  onUnlink: (account: LinkedAccount) => void
}

function AccountsList({
  accounts,
  config,
  hasPasskeySignIn,
  linkingProviderId,
  unlinkingId,
  actionErrorTarget,
  onLink,
  onUnlink,
}: AccountsListProps) {
  const configuredProviderIds = new Set(
    config.providers.map((provider) => provider.providerId),
  )
  const staleOAuthAccounts = accounts.filter(
    (account) =>
      account.providerId !== "credential" &&
      !configuredProviderIds.has(account.providerId),
  )

  return (
    <List>
      {config.providers.map((provider) => {
        const providerAccount = accounts.find(
          (account) => account.providerId === provider.providerId,
        )
        return providerAccount ? (
          <AccountRow
            key={providerAccount.id}
            label={provider.displayName}
            sublabel={linkedAccountLabel(providerAccount)}
            busy={unlinkingId === providerAccount.id}
            failed={actionErrorTarget === providerAccount.id}
            canUnlink={canRemoveAccount(
              providerAccount,
              accounts,
              config,
              hasPasskeySignIn,
            )}
            onAction={() => onUnlink(providerAccount)}
            provider={provider}
          />
        ) : (
          <LinkRow
            key={provider.providerId}
            provider={provider}
            label={provider.displayName}
            busy={linkingProviderId === provider.providerId}
            failed={actionErrorTarget === provider.providerId}
            onLink={() => onLink(provider)}
          />
        )
      })}

      {staleOAuthAccounts.map((account) => (
        <AccountRow
          key={account.id}
          label={account.providerId}
          sublabel={t("{label} · No longer configured", {
            label: linkedAccountLabel(account),
          })}
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
    </List>
  )
}

function linkedAccountLabel(account: LinkedAccount): string {
  return account.accountLabel
    ? t("Connected as {label}", { label: account.accountLabel })
    : t("Connected")
}

function LinkRow(props: {
  provider: Provider
  label: string
  busy: boolean
  failed: boolean
  onLink: () => void
}) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon provider={props.provider} />
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-foreground-dim text-xs">{t("Not linked")}</p>
        </div>
      </div>
      <FeedbackButton
        type="button"
        variant="outline"
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
  provider?: Provider
}

function AccountRow(props: AccountRowProps) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon provider={props.provider} />
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-foreground-dim text-xs">{props.sublabel}</p>
        </div>
      </div>
      <FeedbackButton
        type="button"
        variant="outline"
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

function ProviderIcon({ provider }: { provider?: Provider }) {
  return (
    <span
      className="border-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border"
      style={{
        backgroundColor: provider?.buttonColor,
        color: provider?.buttonTextColor,
      }}
    >
      {provider?.iconUrl ? (
        <img src={provider.iconUrl} alt="" className="size-4 object-contain" />
      ) : (
        <UserKeyIcon className="size-4" />
      )}
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

  const remaining = accounts.filter((account) => account.id !== target.id)
  return remaining.some((account) => accountSupportsSignIn(account, config))
}

function accountSupportsSignIn(
  account: LinkedAccount,
  config: PublicAuthConfig,
): boolean {
  if (account.providerId === "credential") return false
  return config.providers.some(
    (provider) => provider.providerId === account.providerId,
  )
}
