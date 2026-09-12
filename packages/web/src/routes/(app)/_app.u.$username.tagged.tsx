import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/(app)/_app/u/$username/tagged")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/u/$username/all", params, replace: true })
  },
})
