import type { PublicAuthConfig } from "@alloy/api"
import { OAUTH_LINK_QUERY_KEY } from "@alloy/contracts"
import { createFileRoute } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import {
  OAuthLinkPage,
  type PendingLink,
} from "@/components/routes/login/oauth-link-page"
import { authClient } from "@/lib/auth-client"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { clientLogger } from "@/lib/client-log"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"
import { searchString } from "@/lib/route-search"

type LoginSearch = {
  redirect?: string
  reactivate?: boolean
  [OAUTH_LINK_QUERY_KEY]?: string
}

/**
 * The OAuth sign-in this browser holds for linking, if any. The callback adds
 * the link param when it keeps one, but only the server knows whether it
 * exists, so a crafted link URL shows the normal login page.
 */
async function loadPendingLink(
  config: PublicAuthConfig,
  search: LoginSearch,
): Promise<PendingLink | null> {
  if (!search[OAUTH_LINK_QUERY_KEY]) return null
  const { data, error } = await authClient.oauth2.pending.get()
  if (error)
    clientLogger.warn("[auth] Pending OAuth link lookup failed.", error)
  if (!data) return null
  const provider = config.providers.find(
    (candidate) => candidate.providerId === data.providerId,
  )
  return provider ? { provider, accountLabel: data.accountLabel } : null
}

export const Route = createFileRoute("/(auth)/_auth/login")({
  validateSearch: (search) => {
    const result: LoginSearch = {}
    const target = sanitizeLoginRedirect(search.redirect)
    if (target) result.redirect = target
    if (search.reactivate === true || search.reactivate === "true") {
      result.reactivate = true
    }
    const provider = searchString(search[OAUTH_LINK_QUERY_KEY])
    if (provider) result[OAUTH_LINK_QUERY_KEY] = provider
    return result
  },
  beforeLoad: async ({ context, search }) => {
    const pendingLink = await loadPendingLink(context.authConfig, search)
    // A signed-in user confirms the pending link on this page.
    if (!pendingLink) redirectAuthedBeforeLoad({ context, search })
    return { pendingLink }
  },
  loader: ({ context }) => ({
    config: context.authConfig,
    pendingLink: context.pendingLink,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { config, pendingLink } = Route.useLoaderData()
  const search = Route.useSearch()
  // The router spreads the raw query under validateSearch's result, so a
  // value it dropped still shows up here. Check what the page acts on again.
  const redirectTo = sanitizeLoginRedirect(search.redirect) ?? undefined

  if (pendingLink) {
    return (
      <OAuthLinkPage
        config={config}
        link={pendingLink}
        redirectTo={redirectTo}
      />
    )
  }
  return (
    <LoginPageInner
      config={config}
      redirectTo={redirectTo}
      reactivate={search.reactivate === true}
    />
  )
}
