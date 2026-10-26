import type { PublicAuthConfig } from "@alloy/api"
import { OAUTH_LINK_QUERY_KEY } from "@alloy/contracts"
import { createFileRoute } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { OAuthLinkPage } from "@/components/routes/login/oauth-link-page"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"
import { searchString } from "@/lib/route-search"

type LoginSearch = {
  redirect?: string
  reactivate?: boolean
  [OAUTH_LINK_QUERY_KEY]?: string
}

/** The enabled provider an OAuth sign-in asked to link, if any. */
function linkProvider(config: PublicAuthConfig, search: LoginSearch) {
  const providerId = search[OAUTH_LINK_QUERY_KEY]
  if (!providerId) return null
  return (
    config.providers.find((provider) => provider.providerId === providerId) ??
    null
  )
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
  beforeLoad: ({ context, search }) => {
    // A signed-in user confirms the pending link on this page.
    if (linkProvider(context.authConfig, search)) return
    redirectAuthedBeforeLoad({ context, search })
  },
  loader: ({ context }) => ({ config: context.authConfig }),
  component: LoginPage,
})

function LoginPage() {
  const { config } = Route.useLoaderData()
  const search = Route.useSearch()
  // The router spreads the raw query under validateSearch's result, so a
  // value it dropped still shows up here. Check what the page acts on again.
  const redirectTo = sanitizeLoginRedirect(search.redirect) ?? undefined
  const provider = linkProvider(config, search)

  if (provider) {
    return (
      <OAuthLinkPage
        config={config}
        provider={provider}
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
