import type { AdminGameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Card } from "@alloy/ui/components/card"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { GameIcon } from "@alloy/ui/components/game-icon"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { List, ListItem } from "@alloy/ui/components/list"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { adminGamesQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import {
  GAME_ASSET_FIELDS,
  GAME_ASSET_URL,
  removeAdminGameCacheRow,
} from "./admin-game-data"
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

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {hideHeader ? (
          <span className="text-foreground-muted text-sm tabular-nums">
            {summary}
          </span>
        ) : (
          <p className="text-foreground-muted text-sm">
            {t("Create and manage custom games and their artwork.")}
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
      ) : isPending ? (
        <Spinner className="size-5" />
      ) : games.length === 0 ? (
        <ListEmpty title={t("No games yet")} />
      ) : filteredGames.length === 0 ? (
        <ListEmpty title={t("No games found")} />
      ) : (
        <List>
          {filteredGames.map((game) => (
            <AdminGameListRow key={game.id} game={game} />
          ))}
        </List>
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

function AdminGameListRow({ game }: { game: AdminGameRow }) {
  const isCustom = game.source === "custom"
  return (
    <ListItem className="items-center gap-3">
      <GameIcon
        src={game.iconUrl ?? game.logoUrl ?? game.gridUrl}
        name={game.name}
        className="size-8 rounded-md [&_img]:object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{game.name}</span>
        <span className="text-foreground-muted truncate text-xs">
          {game.slug}
        </span>
      </div>
      <Badge variant={isCustom ? "accent" : "secondary"} size="text">
        {isCustom ? t("Custom") : t("SteamGridDB")}
      </Badge>
      <span className="text-foreground-muted text-xs tabular-nums">
        {game.clipCount} {game.clipCount === 1 ? t("clip") : t("clips")}
      </span>
      {isCustom ? <CustomGameActions game={game} /> : null}
    </ListItem>
  )
}

function CustomGameActions({ game }: { game: AdminGameRow }) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.admin.deleteGame(game.id)
      removeAdminGameCacheRow(queryClient, game.id)
      toast.success(t("Game deleted"))
      setDeleteOpen(false)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't delete game")))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <EditGameDialog game={game} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("Delete game")}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2Icon />
      </Button>
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("Delete this game?")}
        description={t(
          "Its artwork is removed and any clips lose their game tag. This can't be undone.",
        )}
        confirmLabel={t("Delete")}
        pendingLabel={t("Deleting")}
        pending={deleting}
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
      <div className="grid grid-cols-2 gap-2">
        {GAME_ASSET_FIELDS.map((asset) => {
          const currentUrl = game[GAME_ASSET_URL[asset.role]] as string | null

          return (
            <div
              key={asset.role}
              className="border-border bg-surface-sunken flex items-center gap-2 rounded-md border p-2"
            >
              <div className="border-border/70 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border">
                {currentUrl ? (
                  <GameIcon
                    src={currentUrl}
                    name={`${game.name} ${asset.label}`}
                    className="size-full rounded-none"
                  />
                ) : (
                  <ImageIcon
                    className="text-foreground-faint size-4"
                    aria-hidden
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">
                  {asset.label}
                </div>
                <div className="text-foreground-faint truncate text-xs">
                  {currentUrl ? t("Uploaded") : t("Not set")}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
