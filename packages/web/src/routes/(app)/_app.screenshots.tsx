import { createFileRoute } from "@tanstack/react-router"

import { HomePageInner } from "@/components/routes/home/home-page-inner"
import { parseHomeSearch } from "@/lib/home-search"

export const Route = createFileRoute("/(app)/_app/screenshots")({
  validateSearch: parseHomeSearch,
  component: () => <HomePageInner screenshots />,
})
