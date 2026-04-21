import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { LinkIcon, Link2OffIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "../../../lib/auth-client"
import { type PublicAuthConfig } from "../../../lib/auth-config"
import { useSuspenseAuthConfig } from "../../../lib/session-suspense"

type Account = {
  id: string
  providerId: string
  accountId: string
  createdAt: string | Date
}

type Provider = PublicAuthConfig["provider"]

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
  const provider = config.provider
  const { accounts, loading, refresh } = useAccounts()
  const [linking, setLinking] = React.useState(false)
  const [unlinkingId, setUnlinkingId] = React.useState<string | null>(null)

  if (!provider && !loading && (accounts?.length ?? 0) <= 1) return null

  async function onLink() {
    if (!provider || linking) return
    setLinking(true)
    try {
      const { error } = await authClient.oauth2.link({
        providerId: provider.providerId,
        callbackURL: `${window.location.origin}/user-settings`,
      })
      if (error) {
        toast.error(error.message ?? "Couldn't start link flow")
        setLinking(false)
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't start link flow"
      )
      setLinking(false)
    }
  }

  async function onUnlink(account: Account) {
    if (unlinkingId) return
    if ((accounts?.length ?? 0) <= 1) {
      toast.error(
        "This is your only sign-in method. Link another before removing it."
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
            provider={provider}
            linking={linking}
            unlinkingId={unlinkingId}
            onLink={onLink}
            onUnlink={onUnlink}
          />
        )}
      </CardContent>
    </Card>
  )
}

type AccountsListProps = {
  accounts: Account[]
  provider: Provider
  linking: boolean
  unlinkingId: string | null
  onLink: () => void
  onUnlink: (account: Account) => void
}

function AccountsList({
  accounts,
  provider,
  linking,
  unlinkingId,
  onLink,
  onUnlink,
}: AccountsListProps) {
  const canUnlink = accounts.length > 1
  const credentialAccount = accounts.find((a) => a.providerId === "credential")
  const oauthAccount = provider
    ? accounts.find((a) => a.providerId === provider.providerId)
    : undefined

  return (
    <ul className="flex flex-col divide-y divide-border">
      {credentialAccount ? (
        <AccountRow
          label="Email and password"
          sublabel="Sign in with your password"
          actionLabel="Remove password"
          busy={unlinkingId === credentialAccount.id}
          onAction={() => onUnlink(credentialAccount)}
          canUnlink={canUnlink}
        />
      ) : null}
      {provider ? (
        oauthAccount ? (
          <AccountRow
            label={provider.displayName}
            sublabel="Connected"
            actionLabel="Unlink"
            busy={unlinkingId === oauthAccount.id}
            onAction={() => onUnlink(oauthAccount)}
            canUnlink={canUnlink}
          />
        ) : (
          <LinkRow
            label={provider.displayName}
            busy={linking}
            onLink={onLink}
          />
        )
      ) : null}
    </ul>
  )
}

function LinkRow(props: { label: string; busy: boolean; onLink: () => void }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.label}</div>
        <p className="text-xs text-foreground-dim">Not linked</p>
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
  actionLabel: string
  busy: boolean
  canUnlink: boolean
  onAction: () => void
}

function AccountRow(props: AccountRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.label}</div>
        <p className="text-xs text-foreground-dim">{props.sublabel}</p>
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
            : "Link another sign-in method before removing this one"
        }
      >
        <Link2OffIcon />
        {props.busy ? "Removing…" : props.actionLabel}
      </Button>
    </li>
  )
}
