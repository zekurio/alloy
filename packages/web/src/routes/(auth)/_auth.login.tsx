import type { PublicAuthConfig } from "@alloy/api"
import { OAUTH_LINK_QUERY_KEYS } from "@alloy/contracts"
import { createFileRoute } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { OAuthLinkPage } from "@/components/routes/login/oauth-link-page"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { validateUsername } from "@/lib/form-validators"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"
import { searchText } from "@/lib/route-search"

type LoginSearch = {
  redirect?: string
  reactivate?: boolean
  [OAUTH_LINK_QUERY_KEYS.provider]?: string
  [OAUTH_LINK_QUERY_KEYS.username]?: string
}

/** The enabled provider an OAuth sign-in asked to link, if any. */
function linkProvider(config: PublicAuthConfig, search: LoginSearch) {
  const providerId = search[OAUTH_LINK_QUERY_KEYS.provider]
  if (!providerId) return null
  return (
    config.providers.find((provider) => provider.providerId === providerId) ??
    null
  )
}

/** A username fit to show in the link notice, which anyone can link to. */
function linkUsername(cause: unknown): string | undefined {
  const username = searchText(cause)
  return username && validateUsername(username) === undefined
    ? username
    : undefined
}

export const Route = createFileRoute("/(auth)/_auth/login")({
  validateSearch: (search) => {
    const result: LoginSearch = {}
    const target = sanitizeLoginRedirect(search.redirect)
    if (target) result.redirect = target
    if (search.reactivate === true || search.reactivate === "true") {
      result.reactivate = true
    }
    const provider = searchText(search[OAUTH_LINK_QUERY_KEYS.provider])
    if (provider) result[OAUTH_LINK_QUERY_KEYS.provider] = provider
    const username = linkUsername(search[OAUTH_LINK_QUERY_KEYS.username])
    if (username) result[OAUTH_LINK_QUERY_KEYS.username] = username
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
        username={linkUsername(search[OAUTH_LINK_QUERY_KEYS.username])}
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
