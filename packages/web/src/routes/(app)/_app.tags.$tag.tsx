import { sanitizeTag } from "@alloy/contracts"
import { createFileRoute } from "@tanstack/react-router"

import { TagsPageInner } from "@/components/routes/tags/tags-page-inner"
import {
  tagClipsInfiniteQueryOptions,
  tagSummaryQueryOptions,
} from "@/lib/tag-queries"
import { parseTagSearch, tagFilters } from "@/lib/tag-search"

export const Route = createFileRoute("/(app)/_app/tags/$tag")({
  validateSearch: parseTagSearch,
  loaderDeps: ({ search }) => ({
    game: search.game,
    sort: search.sort,
  }),
  loader: ({ context, deps, params }) => {
    const tag = sanitizeTag(params.tag)
    void context.queryClient.prefetchQuery(tagSummaryQueryOptions(tag))
    void context.queryClient.prefetchInfiniteQuery(
      tagClipsInfiniteQueryOptions(tag, tagFilters(deps)),
    )
  },
  component: TagsPage,
})

function TagsPage() {
  const { tag } = Route.useParams()

  return <TagsPageInner tag={tag} />
}
