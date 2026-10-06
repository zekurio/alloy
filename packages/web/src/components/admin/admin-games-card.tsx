import type { AdminGameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Card } from "@alloy/ui/components/card"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { SearchIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { GameIcon } from "@/components/game/game-icon"
import { adminGamesQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { removeAdminGameCacheRow } from "./admin-game-data"
import { CreateGameDialog, EditGameDialog } from "./admin-game-dialogs"

export function AdminGamesCard({ hideHeader }: { hideHeader?: boolean }) {
  const { data: games, isPending, error } = useQuery(adminGamesQueryOptions())
  const [search, setSearch] = useState("")
  const filteredGames = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!games || !normalizedSearch) return games ?? []
    return games.filter((game) => {
      const name = game.name.toLocaleLowerCase()
      const slug = game.slug.toLocaleLowerCase()
      return name.includes(normalizedSearch) || slug.includes(normalizedSearch)
    })
  }, [games, search])

  const summary =
    games && games.length > 0
      ? games.length === 1
        ? t("{count} game", { count: games.length })
        : t("{count} games", { count: games.length })
      : null

  const body = isPending ? (
    <LoadingState variant="panel" />
  ) : (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {hideHeader ? (
          <span className="text-foreground-muted text-sm tabular-nums">
            {summary}
          </span>
        ) : (
          <p className="text-foreground-muted text-sm">
            {t("Manage games and their artwork.")}
          </p>
        )}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <InputGroup className="w-full sm:max-w-xs">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="text-foreground-muted size-4" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search games")}
              aria-label={t("Search games")}
            />
          </InputGroup>
          <CreateGameDialog />
        </div>
      </div>

      {error ? (
        <Callout tone="destructive">
          {errorMessage(error, t("Couldn't load games"))}
        </Callout>
      ) : games.length === 0 ? (
        <ListEmpty title={t("No games yet")} />
      ) : filteredGames.length === 0 ? (
        <ListEmpty title={t("No games found")} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3">
          {filteredGames.map((game) => (
            <AdminGameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  )

  if (hideHeader) return body

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Games")}</SectionTitle>
      </SectionHeader>
      <SectionContent>{body}</SectionContent>
    </Section>
  )
}

function AdminGameCard({ game }: { game: AdminGameRow }) {
  return (
    <Card className="flex-row items-center gap-4 p-4">
      <div className="flex h-16 w-20 shrink-0 items-center justify-center">
        <GameIcon
          src={game.logoUrl ?? game.iconUrl}
          name={game.name}
          className="size-full rounded-none bg-transparent text-3xl [&_img]:object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold" title={game.name}>
          {game.name}
        </div>
        <div
          className="text-foreground-muted truncate text-sm"
          title={game.slug}
        >
          {game.slug}
        </div>
        <div className="text-foreground-faint mt-1 text-xs tabular-nums">
          {game.clipCount} {game.clipCount === 1 ? t("clip") : t("clips")}
        </div>
      </div>
      <GameActions game={game} />
    </Card>
  )
}

function GameActions({ game }: { game: AdminGameRow }) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = async () => {
    if (deleting) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await api.admin.deleteGame(game.id)
      removeAdminGameCacheRow(queryClient, game.id)
      setDeleteOpen(false)
    } catch (cause) {
      setDeleteError(errorMessage(cause, t("Couldn't delete game")))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <EditGameDialog game={game} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-danger hover:text-danger"
        aria-label={t("Delete game")}
        disabled={game.clipCount > 0}
        title={
          game.clipCount > 0
            ? t("Only games without clips can be deleted.")
            : t("Delete game")
        }
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setDeleteError(null)
        }}
        title={t("Delete this game?")}
        description={t(
          "The game and its artwork will be removed. This can't be undone.",
        )}
        confirmLabel={t("Delete")}
        pendingLabel={t("Deleting")}
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
      >
        <DeleteGamePreview game={game} />
      </ConfirmDeleteDialog>
    </div>
  )
}

function DeleteGamePreview({ game }: { game: AdminGameRow }) {
  const clipCount =
    game.clipCount === 1
      ? t("1 linked clip")
      : t("{count} linked clips", { count: game.clipCount })

  return (
    <Card className="gap-3 p-3">
      <div className="flex items-center gap-3">
        <GameIcon
          src={game.iconUrl ?? game.logoUrl ?? game.gridUrl}
          name={game.name}
          className="size-10 rounded-md [&_img]:object-contain"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{game.name}</div>
          <div className="text-foreground-muted truncate text-xs">
            {game.slug} · {clipCount}
          </div>
        </div>
      </div>
    </Card>
  )
}
