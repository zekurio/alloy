import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/(app)/_app/u/$username/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/u/$username/feed",
      params: { username: params.username },
      replace: true,
    })
  },
})
