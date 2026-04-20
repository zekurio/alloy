import { createFileRoute } from "@tanstack/react-router"

import { EmptyState } from "../components/empty-state"

/**
 * `/u/$username/tagged` — placeholder until clip tagging lands. Lives as
 * its own route so the tab nav's active state lines up with the URL.
 */
export const Route = createFileRoute("/_app/u/$username/tagged")({
  component: ProfileTaggedTab,
})

function ProfileTaggedTab() {
  return (
    <EmptyState
      seed="profile-tagged-empty"
      size="lg"
      title="No tagged clips yet"
      hint="Clips where this user is tagged will show up here."
    />
  )
}
