import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { Link2OffIcon, LinkIcon, UserKeyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/sonner"

import type { PublicAuthConfig } from "@workspace/api"

import { authClient, useSession } from "@/lib/auth-client"
import { api } from "@/lib/api"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

type Account = {
  id: string
  providerId: string
  accountId: string
  createdAt: string | Date
}

type Provider = NonNullable<PublicAuthConfig["provider"]>
const OAUTH_LINKED_QUERY_KEY = "oauthLinked"

function useAccounts() {
  const [accounts, setAccounts] = React.useState<Account[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    const { data, error } = await authClient.listAccounts()
    if (error) {
      toast.error(error.message ?? "Couldn't load linked accounts")
      setAccounts([])
      return
    }
    setAccounts((data ?? []) as Account[])
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  return { accounts, loading, refresh }
}

export function LinkedAccountsCard() {
  const router = useRouter()
  const config = useSuspenseAuthConfig()
  const { accounts, loading, refresh } = useAccounts()
  const actions = useLinkedAccountActions({
    accounts: accounts ?? [],
    config,
    refresh,
    router,
  })

  if (shouldHideLinkedAccountsCard(config, accounts, loading)) {
    return null
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div>
          <div className="text-sm font-medium">Linked accounts</div>
          <p className="mt-0.5 text-xs text-foreground-dim">
            Connect additional sign-in methods to your account.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-foreground-muted">Loading…</p>
        ) : (
          <AccountsList
            accounts={accounts ?? []}
            config={config}
            linkingProviderId={actions.linkingProviderId}
            unlinkingId={actions.unlinkingId}
            onLink={actions.onLink}
            onUnlink={actions.onUnlink}
          />
        )}
      </CardContent>
    </Card>
  )
}

function shouldHideLinkedAccountsCard(
  config: PublicAuthConfig,
  accounts: Account[] | null,
  loading: boolean
): boolean {
  return (
    config.provider === null &&
    !loading &&
    (accounts?.filter((account) => account.providerId !== "credential")
      .length ?? 0) === 0
  )
}

function useLinkedAccountActions({
  accounts,
  config,
  refresh,
  router,
}: {
  accounts: Account[]
  config: PublicAuthConfig
  refresh: () => Promise<void>
  router: ReturnType<typeof useRouter>
}) {
  const { refetch: refetchSession } = useSession()
  const [linkingProviderId, setLinkingProviderId] = React.useState<
    string | null
  >(null)
  const [unlinkingId, setUnlinkingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const url = new URL(window.location.href)
    if (url.searchParams.get(OAUTH_LINKED_QUERY_KEY) !== "1") return

    let active = true

    const clearMarker = () => {
      url.searchParams.delete(OAUTH_LINKED_QUERY_KEY)
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`
      )
    }

    void (async () => {
      try {
        await api.users.syncOAuthProfile()
        await refresh()
        await refetchSession({ query: { disableCookieCache: true } })
        await router.invalidate()
      } catch (cause) {
        if (active) {
          toast.error(
            cause instanceof Error
              ? cause.message
              : "Couldn't sync linked account profile"
          )
        }
      } finally {
        if (active) clearMarker()
      }
    })()

    return () => {
      active = false
    }
  }, [refetchSession, refresh, router])

  const onLink = React.useCallback(
    async (provider: Provider) => {
      if (linkingProviderId) return
      setLinkingProviderId(provider.providerId)
      try {
        const { error } = await authClient.oauth2.link({
          providerId: provider.providerId,
          callbackURL: `${window.location.origin}/user-settings?${OAUTH_LINKED_QUERY_KEY}=1`,
        })
        if (error) {
          toast.error(error.message ?? "Couldn't start link flow")
          setLinkingProviderId(null)
        }
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Couldn't start link flow"
        )
        setLinkingProviderId(null)
      }
    },
    [linkingProviderId]
  )

  const onUnlink = React.useCallback(
    async (account: Account) => {
      if (unlinkingId) return
      if (!canRemoveAccount(account, accounts, config)) {
        toast.error(
          "This is your last enabled sign-in method. Link another before removing it."
        )
        return
      }
      setUnlinkingId(account.id)
      try {
        const { error } = await authClient.unlinkAccount({
          providerId: account.providerId,
          accountId: account.accountId,
        })
        if (error) {
          toast.error(error.message ?? "Couldn't unlink")
          return
        }
        toast.success("Account unlinked")
        await refresh()
        await router.invalidate()
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Couldn't unlink")
      } finally {
        setUnlinkingId(null)
      }
    },
    [accounts, config, refresh, router, unlinkingId]
  )

  return {
    linkingProviderId,
    unlinkingId,
    onLink,
    onUnlink,
  }
}

type AccountsListProps = {
  accounts: Account[]
  config: PublicAuthConfig
  linkingProviderId: string | null
  unlinkingId: string | null
  onLink: (provider: Provider) => void
  onUnlink: (account: Account) => void
}

function AccountsList({
  accounts,
  config,
  linkingProviderId,
  unlinkingId,
  onLink,
  onUnlink,
}: AccountsListProps) {
  const credentialAccount = accounts.find(
    (account) => account.providerId === "credential"
  )
  const providerAccount = config.provider
    ? accounts.find(
        (account) => account.providerId === config.provider?.providerId
      )
    : undefined
  const staleOAuthAccounts = accounts.filter(
    (account) =>
      account.providerId !== "credential" &&
      account.providerId !== config.provider?.providerId
  )

  return (
    <ul className="flex flex-col divide-y divide-border">
      {credentialAccount ? (
        <AccountRow
          key={credentialAccount.id}
          label="Email and password"
          sublabel={
            config.emailPasswordEnabled
              ? "Connected"
              : "Configured account, but password login is currently disabled"
          }
          busy={unlinkingId === credentialAccount.id}
          canUnlink={canRemoveAccount(credentialAccount, accounts, config)}
          onAction={() => onUnlink(credentialAccount)}
        />
      ) : null}

      {config.provider ? (
        providerAccount ? (
          <AccountRow
            key={providerAccount.id}
            label={config.provider.displayName}
            sublabel="Connected"
            busy={unlinkingId === providerAccount.id}
            canUnlink={canRemoveAccount(providerAccount, accounts, config)}
            onAction={() => onUnlink(providerAccount)}
            showIcon
          />
        ) : (
          <LinkRow
            key={config.provider.providerId}
            label={config.provider.displayName}
            busy={linkingProviderId === config.provider.providerId}
            onLink={() =>
              config.provider ? onLink(config.provider) : undefined
            }
          />
        )
      ) : null}

      {staleOAuthAccounts.map((account) => (
        <AccountRow
          key={account.id}
          label={account.providerId}
          sublabel="Linked, but no longer configured on this server"
          busy={unlinkingId === account.id}
          canUnlink={canRemoveAccount(account, accounts, config)}
          onAction={() => onUnlink(account)}
          showIcon
        />
      ))}
    </ul>
  )
}

function LinkRow(props: { label: string; busy: boolean; onLink: () => void }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
          <UserKeyIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-xs text-foreground-dim">Not linked</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.busy}
        onClick={props.onLink}
      >
        <LinkIcon />
        {props.busy ? "Redirecting…" : "Link"}
      </Button>
    </li>
  )
}

type AccountRowProps = {
  label: string
  sublabel: string
  busy: boolean
  canUnlink: boolean
  onAction: () => void
  showIcon?: boolean
}

function AccountRow(props: AccountRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        {props.showIcon ? (
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
            <UserKeyIcon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-xs text-foreground-dim">{props.sublabel}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.busy || !props.canUnlink}
        onClick={props.onAction}
        title={
          props.canUnlink
            ? undefined
            : "Link another enabled sign-in method before removing this one"
        }
      >
        <Link2OffIcon />
        {props.busy ? "Removing…" : "Unlink"}
      </Button>
    </li>
  )
}

function canRemoveAccount(
  target: Account,
  accounts: Account[],
  config: PublicAuthConfig
): boolean {
  const remaining = accounts.filter((account) => account.id !== target.id)
  return remaining.some((account) => accountSupportsSignIn(account, config))
}

function accountSupportsSignIn(
  account: Account,
  config: PublicAuthConfig
): boolean {
  if (account.providerId === "credential") return config.emailPasswordEnabled
  return config.provider?.providerId === account.providerId
}
