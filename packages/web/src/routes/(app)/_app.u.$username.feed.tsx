import { createFileRoute, redirect } from "@tanstack/react-router"

// The profile "Home" tab was merged into "Uploads". Keep the old URL working
// for existing links by redirecting to the unified clips tab.
export const Route = createFileRoute("/(app)/_app/u/$username/feed")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/u/$username/all",
      params: { username: params.username },
      replace: true,
    })
  },
})
