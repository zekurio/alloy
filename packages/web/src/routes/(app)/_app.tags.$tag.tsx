import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { TagsPageInner } from "@/components/routes/tags/tags-page-inner"
import { parseTagSearch } from "@/lib/tag-search"

export const Route = createFileRoute("/(app)/_app/tags/$tag")({
  validateSearch: parseTagSearch,
  component: TagsPage,
})

function TagsPage() {
  const { tag } = Route.useParams()

  return (
    <Suspense fallback={null}>
      <TagsPageInner tag={tag} />
    </Suspense>
  )
}
