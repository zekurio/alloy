import type { ProfileMediaParams } from "@alloy/contracts"
import { infiniteQueryOptions } from "@tanstack/react-query"

import { api } from "./api"
import { clipKeys } from "./clip-query-keys"

export function profileMediaQueryOptions(
  username: string,
  params: Pick<ProfileMediaParams, "tab" | "media" | "sort" | "game">,
) {
  return infiniteQueryOptions({
    queryKey: [...clipKeys.infinite(), "profile-media", username, params],
    // SAFETY: The offset cursor is a string; null denotes the first page.
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const items = await api.users.fetchMedia(username, {
        ...params,
        limit: 30,
        offset: Number(pageParam ?? 0),
      })
      return {
        items,
        nextCursor:
          items.length === 30
            ? String(Number(pageParam ?? 0) + items.length)
            : null,
      }
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}
