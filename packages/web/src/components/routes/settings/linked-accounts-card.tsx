import type { PublicAuthConfig } from "@alloy/api"
import type { LinkedAccount as ApiLinkedAccount } from "@alloy/api/auth"
import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { List, ListItem } from "@alloy/ui/components/list"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { toast } from "@alloy/ui/lib/toast"
import { useRouter } from "@tanstack/react-router"
import { Link2OffIcon, LinkIcon, UserKeyIcon } from "lucide-react"
import * as React from "react"

import { authClient, useSession } from "@/lib/auth-client"
import { authCallbackUrl, toastAuthAttemptFailure } from "@/lib/auth-flow"
import { consumeCurrentQueryParam } from "@/lib/browser-url"
import { errorMessage } from "@/lib/error-message"

export type LinkedAccount = ApiLinkedAccount

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
    <Section>
      <SectionContent className="flex flex-col gap-3 py-4">
        <div>
          <div className="text-sm font-medium">{tx("Linked accounts")}</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            {tx("Connect additional sign-in methods to your account.")}
          </p>
        </div>
        <AccountsList
          accounts={accounts}
          config={config}
          hasPasskeySignIn={hasPasskeySignIn}
          linkingProviderId={actions.linkingProviderId}
          unlinkingId={actions.unlinkingId}
          onLink={actions.onLink}
          onUnlink={actions.onUnlink}
        />
      </SectionContent>
    </Section>
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
  const [linkingProviderId, setLinkingProviderId] = React.useState<
    string | null
  >(null)
  const [unlinkingId, setUnlinkingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (consumeCurrentQueryParam(OAUTH_LINKED_QUERY_KEY) !== "1") return

    let active = true

    void (async () => {
      try {
        await refresh()
        await refetchSession({ query: { disableCookieCache: true } })
        await router.invalidate()
      } catch (cause) {
        if (active) {
          toast.error(
            errorMessage(cause, tx("Couldn't refresh linked accounts")),
          )
        }
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
          callbackURL: authCallbackUrl(`/settings?${OAUTH_LINKED_QUERY_KEY}=1`),
        })
        if (error) {
          toastAuthAttemptFailure(
            "OAuth link",
            "Couldn't start link flow",
            error,
          )
          setLinkingProviderId(null)
        }
      } catch (cause) {
        toastAuthAttemptFailure("OAuth link", "Couldn't start link flow", cause)
        setLinkingProviderId(null)
      }
    },
    [linkingProviderId],
  )

  const onUnlink = React.useCallback(
    async (account: LinkedAccount) => {
      if (unlinkingId) return
      if (!canRemoveAccount(account, accounts, config, hasPasskeySignIn)) {
        toast.error(
          tx(
            "This is your last enabled sign-in method. Link another before removing it.",
          ),
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
          toast.error(errorMessage(error, tx("Couldn't unlink")))
          return
        }
        toast.success(tx("Account unlinked"))
        await refresh()
        await router.invalidate()
      } catch (cause) {
        toast.error(errorMessage(cause, tx("Couldn't unlink")))
      } finally {
        setUnlinkingId(null)
      }
    },
    [accounts, config, hasPasskeySignIn, refresh, router, unlinkingId],
  )

  return {
    linkingProviderId,
    unlinkingId,
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
  onLink: (provider: Provider) => void
  onUnlink: (account: LinkedAccount) => void
}

function AccountsList({
  accounts,
  config,
  hasPasskeySignIn,
  linkingProviderId,
  unlinkingId,
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
            onLink={() => onLink(provider)}
          />
        )
      })}

      {staleOAuthAccounts.map((account) => (
        <AccountRow
          key={account.id}
          label={account.providerId}
          sublabel={tx("{label} · No longer configured", {
            label: linkedAccountLabel(account),
          })}
          busy={unlinkingId === account.id}
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
  return account.email
    ? tx("Connected as {email}", { email: account.email })
    : tx("Connected")
}

function LinkRow(props: {
  provider: Provider
  label: string
  busy: boolean
  onLink: () => void
}) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon provider={props.provider} />
        <div className="min-w-0">
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-foreground-dim text-xs">{tx("Not linked")}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={props.busy}
        onClick={props.onLink}
      >
        <LinkIcon />
        {props.busy ? tx("Redirecting…") : tx("Link")}
      </Button>
    </ListItem>
  )
}

type AccountRowProps = {
  label: string
  sublabel: string
  busy: boolean
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={props.busy || !props.canUnlink}
        onClick={props.onAction}
        title={
          props.canUnlink
            ? undefined
            : tx("Link another enabled sign-in method before removing this one")
        }
      >
        <Link2OffIcon />
        {props.busy ? tx("Removing…") : tx("Unlink")}
      </Button>
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
