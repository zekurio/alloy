import { type ClipRow, HttpError } from "@alloy/api"
import { UNCATEGORISED_GAME_SLUG } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"

import { useSession } from "@/lib/auth-client"
import { clipGameLabel } from "@/lib/clip-format"
import { formatRelativeTime } from "@/lib/date-format"
import { recommendedClipsQueryOptions } from "@/lib/feed-queries"
import { formatCount } from "@/lib/number-format"
import { userAvatar } from "@/lib/user-display"

import { ClipCardTrigger } from "./clip-card-trigger"
import {
  clipBrowserDownloadActionSupported,
  ClipBrowserDownloadMenuItem,
} from "./clip-download-button"
import { type ClipListEntry, ClipListProvider } from "./clip-list-context"
import { ClipMeta } from "./clip-meta"

export function ClipDetailsPanel({
  row,
  onRequestDelete,
  deletePending,
  onNavigate,
}: {
  row: ClipRow
  onRequestDelete: () => void
  deletePending: boolean
  onNavigate?: ((entry: ClipListEntry) => void) | null
}) {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const recommendations = useQuery(
    recommendedClipsQueryOptions(row.id, session?.user.id ?? null),
  )
  const entries = useMemo(
    () =>
      (recommendations.data?.items ?? []).map((recommended) => ({
        id: recommended.id,
        gameId: recommended.gameRef?.slug ?? UNCATEGORISED_GAME_SLUG,
        row: recommended,
      })),
    [recommendations.data],
  )

  function openClip(recommended: ClipRow) {
    const entry = {
      id: recommended.id,
      gameId: recommended.gameRef?.slug ?? UNCATEGORISED_GAME_SLUG,
      row: recommended,
    }
    if (onNavigate) onNavigate(entry)
    else void navigate({ to: "/clips/$clipId", params: { clipId: entry.id } })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-5">
      <ClipMeta
        clipId={row.id}
        status={row.status}
        encodeActive={row.encodeActive}
        authorId={row.authorId}
        title={row.title}
        game={clipGameLabel(row)}
        gameRef={row.gameRef}
        views={formatCount(row.viewCount)}
        viewCount={row.viewCount}
        postedAt={formatRelativeTime(row.publishedAt ?? row.createdAt)}
        privacy={row.privacy}
        description={row.description}
        mentions={row.mentions ?? []}
        tags={row.tags}
        uploader={{
          handle: row.authorUsername,
          name: row.authorUsername,
          avatar: userAvatar({
            id: row.authorId,
            username: row.authorUsername,
            image: row.authorImage,
          }),
        }}
        downloadAction={
          clipBrowserDownloadActionSupported(row) ? (
            <ClipBrowserDownloadMenuItem row={row} />
          ) : undefined
        }
        onEdit={() => {
          void navigate({
            to: "/library/clips/$clipId",
            params: { clipId: row.id },
          })
        }}
        onRequestDelete={onRequestDelete}
        deletePending={deletePending}
      />
      <section
        className="border-border flex flex-col gap-4 border-t pt-5"
        aria-label={t("Recommended videos")}
      >
        <h2 className="text-foreground text-sm font-semibold">
          {t("Recommended videos")}
        </h2>
        {recommendations.isPending ? (
          <div role="status" aria-label={t("Loading")}>
            <Spinner className="size-5" />
          </div>
        ) : recommendations.error instanceof HttpError &&
          recommendations.error.status === 401 ? (
          <Link
            to="/login"
            search={{ redirect: `/clips/${row.id}` }}
            className="text-accent text-sm hover:underline"
          >
            {t("Sign in to see recommendations")}
          </Link>
        ) : recommendations.isError ? (
          <div className="text-foreground-muted text-sm" role="status">
            <p>{t("Couldn't load recommendations")}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void recommendations.refetch()
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-foreground-muted text-sm">
            {t("No other videos yet")}
          </p>
        ) : (
          <ClipListProvider
            listKey={`recommendations:${row.id}`}
            entries={entries}
          >
            {entries.map((entry) => (
              <ClipCardTrigger
                key={entry.id}
                row={entry.row}
                metaVariant="compact"
                onOpen={openClip}
              />
            ))}
          </ClipListProvider>
        )}
      </section>
    </div>
  )
}
