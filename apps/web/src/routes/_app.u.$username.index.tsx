import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/u/$username` — bare profile URL. Redirects to the default tab so all
 * profile surfaces live under a tab segment (`feed` / `all` / `tagged`).
 * Keeping the redirect lets old bookmarks (and cross-links that drop the
 * tab) keep working without a 404.
 */
export const Route = createFileRoute("/_app/u/$username/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/u/$username/feed",
      params: { username: params.username },
      replace: true,
    })
  },
})
