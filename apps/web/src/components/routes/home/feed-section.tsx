import * as React from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import { ClipCardList } from "../../../components/clip-card-list";
import { ClipCardSkeleton } from "../../../components/clip-card-skeleton";
import { ClipGrid } from "../../../components/clip-grid";
import { EmptyState } from "../../../components/empty-state";
import type { FeedFilter } from "../../../lib/feed-api";
import { useFeedInfiniteQuery } from "../../../lib/feed-queries";
import { useQueryErrorToast } from "../../../lib/use-query-error-toast";

type FeedSectionProps = {
  filter: FeedFilter;
  viewerId: string | undefined;
};

const FEED_PAGE_LIMIT = 20;

function useInfiniteScrollSentinel(
  fetchNextPage: () => Promise<unknown>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const fetchNextRef = React.useRef(fetchNextPage);
  fetchNextRef.current = fetchNextPage;
  const hasNextRef = React.useRef(hasNextPage);
  hasNextRef.current = hasNextPage;
  const isFetchingNextRef = React.useRef(isFetchingNextPage);
  isFetchingNextRef.current = isFetchingNextPage;

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (isFetchingNextRef.current || !hasNextRef.current) return;
        void fetchNextRef.current();
      },
      { rootMargin: "800px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return sentinelRef;
}

function emptyTitle(filter: FeedFilter): string {
  switch (filter.kind) {
    case "foryou":
      return "Nothing to show yet";
    case "following":
      return "Your following feed is empty";
    case "game":
      return "No clips in this game yet";
  }
}

function emptyHint(filter: FeedFilter): string {
  switch (filter.kind) {
    case "foryou":
      return "Come back when others have uploaded some clips.";
    case "following":
      return "Follow creators or games to populate this tab.";
    case "game":
      return "Be the first to post one.";
  }
}

function FeedSentinelStatus({
  isFetchingNextPage,
  hasRows,
  error,
  hasNextPage,
  onRetry,
}: {
  isFetchingNextPage: boolean;
  hasRows: boolean;
  error: unknown;
  hasNextPage: boolean;
  onRetry: () => void;
}) {
  if (isFetchingNextPage && hasRows) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xs",
          "text-foreground-faint uppercase tracking-wide",
        )}
      >
        <Loader2Icon className="size-3 animate-spin" />
        Loading more
      </span>
    );
  }
  if (error && hasRows) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium text-accent uppercase tracking-wide",
          "hover:bg-accent-soft",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        Retry
      </button>
    );
  }
  if (!hasNextPage && hasRows) {
    return (
      <span className="text-xs text-foreground-faint uppercase tracking-wide">
        End of feed
      </span>
    );
  }
  return null;
}

export function FeedSection({ filter, viewerId }: FeedSectionProps) {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
  } = useFeedInfiniteQuery(filter, { limit: FEED_PAGE_LIMIT });
  useQueryErrorToast(error, {
    title: "Couldn't load feed",
    // Keying the toast on filter avoids stacked toasts when tabs switch.
    toastId: `feed-${filter.kind}-${filter.kind === "game" ? filter.gameId : ""}-error`,
  });

  const rows = React.useMemo(() => (data ? data.pages.flat() : []), [data]);

  const sentinelRef = useInfiniteScrollSentinel(
    fetchNextPage,
    Boolean(hasNextPage),
    isFetchingNextPage,
  );

  const initialLoad = isPending && rows.length === 0;
  const hasRows = rows.length > 0;

  return (
    <section>
      {initialLoad ? (
        <ClipGrid>
          {Array.from({ length: 10 }).map((_, i) => (
            <ClipCardSkeleton key={i} />
          ))}
        </ClipGrid>
      ) : !hasRows && error ? (
        <EmptyState
          seed={`feed-${filter.kind}-error`}
          size="lg"
          title="Couldn't load feed"
        />
      ) : !hasRows ? (
        <EmptyState
          seed={`feed-${filter.kind}-empty`}
          size="lg"
          title={emptyTitle(filter)}
          hint={emptyHint(filter)}
        />
      ) : (
        <ClipCardList
          rows={rows}
          isOwnedByViewer={(row) => row.authorId === viewerId}
        />
      )}

      <div
        ref={sentinelRef}
        aria-hidden
        className="mt-6 flex min-h-6 items-center justify-center"
      >
        <FeedSentinelStatus
          isFetchingNextPage={isFetchingNextPage}
          hasRows={hasRows}
          error={error}
          hasNextPage={Boolean(hasNextPage)}
          onRetry={() => void refetch()}
        />
      </div>
    </section>
  );
}
