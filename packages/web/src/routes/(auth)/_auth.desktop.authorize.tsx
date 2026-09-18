import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { createFileRoute, redirect } from "@tanstack/react-router"

import {
  isDesktopAuthorizeSearch,
  type DesktopAuthorizeSearch,
} from "@/lib/desktop-authorize"
import { searchString } from "@/lib/route-search"
import { loadAuthConfig, loadSession } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/_auth/desktop/authorize")({
  validateSearch: (search): DesktopAuthorizeSearch => ({
    redirect_uri: searchString(search.redirect_uri),
    state: searchString(search.state),
    code_challenge: searchString(search.code_challenge),
  }),
  loader: async ({ context, location }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.adminAccountRequired) {
      throw redirect({ to: "/setup" })
    }
    const session = context.session ?? (await loadSession())
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
    return { username: session.user.username }
  },
  component: DesktopAuthorizePage,
})

function DesktopAuthorizePage() {
  const { username } = Route.useLoaderData()
  const search = Route.useSearch()

  if (!isDesktopAuthorizeSearch(search)) {
    return (
      <div className="mb-8 space-y-1.5">
        <h1 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Authorize Alloy Desktop")}
        </h1>
        <p className="text-foreground-muted text-sm">
          {t("Invalid desktop login request.")}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h1 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Authorize Alloy Desktop")}
        </h1>
        <p className="text-foreground-muted text-sm">
          {t(
            "Signed in as {username}. Continue only if you opened the Alloy desktop app.",
            { username },
          )}
        </p>
      </div>
      {/* A native form post (not fetch): the API answers with a 302 to the
          desktop app's loopback listener, which the browser must navigate to. */}
      <form
        method="post"
        action="/api/auth/desktop/authorize"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="redirect_uri" value={search.redirect_uri} />
        <input type="hidden" name="state" value={search.state} />
        <input
          type="hidden"
          name="code_challenge"
          value={search.code_challenge}
        />
        <Button type="submit" size="lg" className="w-full">
          {t("Authorize desktop app")}
        </Button>
      </form>
    </>
  )
}
