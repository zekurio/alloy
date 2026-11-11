import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { type HomeSearch, prefetchHomeFeed } from "@/lib/home-search"

// A settings address someone arrived at. Opened from another page, settings
// keeps that page as the real location and only shows this address (see
// `settingsOverPage`). Here there is no page underneath, so this route shows
// the home feed and `_app.tsx` opens the dialog on the page the path names.
// It matches `/settings` too, with an empty splat.
export const Route = createFileRoute("/(app)/_app/settings/$")({
  beforeLoad: ({ context }) => {
    requireStrictAuthBeforeLoad({ context })
  },
  loader: ({ context }) => {
    prefetchHomeFeed(context.queryClient, NO_FILTER)
  },
  component: SettingsHomePage,
})

const NO_FILTER: HomeSearch = {}

function SettingsHomePage() {
  return <HomePageInner search={NO_FILTER} />
}
