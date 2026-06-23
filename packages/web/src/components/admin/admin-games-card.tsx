import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@alloy/ui/components/alert-dialog"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { Input } from "@alloy/ui/components/input"
import { List, ListItem } from "@alloy/ui/components/list"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { adminGamesQueryOptions, adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

const ASSET_FIELDS: { role: GameAssetRole; label: string }[] = [
  { role: "grid", label: t("Cover") },
  { role: "hero", label: t("Banner") },
  { role: "logo", label: t("Logo") },
  { role: "icon", label: t("Icon") },
]

function setAdminGameCacheRow(qc: QueryClient, game: AdminGameRow): void {
  qc.setQueryData<AdminGameRow[]>(adminKeys.games(), (old) => {
    if (!old) return [game]
    return old.some((g) => g.id === game.id)
      ? old.map((g) => (g.id === game.id ? game : g))
      : [game, ...old]
  })
}

function removeAdminGameCacheRow(qc: QueryClient, gameId: string): void {
  qc.setQueryData<AdminGameRow[]>(adminKeys.games(), (old) =>
    old?.filter((g) => g.id !== gameId),
  )
}

function dateInputValue(releaseDate: string | null): string {
  if (!releaseDate) return ""
  const date = new Date(releaseDate)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

function releaseDatePayload(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function AdminGamesCard({ hideHeader }: { hideHeader?: boolean }) {
  const { data: games, isPending, error } = useQuery(adminGamesQueryOptions())

  const body = (
    <div className="flex flex-col gap-3">
      <div
        className={
          hideHeader ? "flex justify-end" : "flex items-center justify-between"
        }
      >
        {hideHeader ? null : (
          <p className="text-foreground-muted text-sm">
            {t("Create and manage custom games and their artwork.")}
          </p>
        )}
        <CreateGameDialog />
      </div>

      {error ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
          {errorMessage(error, t("Couldn't load games"))}
        </div>
      ) : isPending ? (
        <Spinner className="size-5" />
      ) : games.length === 0 ? (
        <p className="text-foreground-muted text-sm">{t("No games yet.")}</p>
      ) : (
        <List>
          {games.map((game) => (
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
      <Badge variant={isCustom ? "accent" : "secondary"}>
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
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.admin.deleteGame(game.id)
      removeAdminGameCacheRow(qc, game.id)
      toast.success(t("Game deleted"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't delete game")))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <EditGameDialog game={game} />
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Delete game")}
            >
              <Trash2Icon />
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this game?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Its artwork is removed and any clips lose their game tag. This can't be undone.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={handleDelete}>
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateGameDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const created = await api.admin.createGame({
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
      })
      setAdminGameCacheRow(qc, created)
      toast.success(t("Game created"))
      setName("")
      setReleaseDate("")
      setOpen(false)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't create game")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button type="button" size="sm">
            <PlusIcon />
            {t("Add game")}
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("New custom game")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("Add artwork after creating the game.")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="new-game-name">{t("Name")}</FieldLabel>
              <Input
                id="new-game-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-game-release">
                {t("Release date")}
              </FieldLabel>
              <Input
                id="new-game-release"
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
              />
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button type="button" variant="ghost">
                  {t("Cancel")}
                </Button>
              }
            />
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {t("Create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function EditGameDialog({ game }: { game: AdminGameRow }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(game.name)
  const [releaseDate, setReleaseDate] = useState(
    dateInputValue(game.releaseDate),
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const updated = await api.admin.updateGame(game.id, {
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
      })
      setAdminGameCacheRow(qc, updated)
      toast.success(t("Game updated"))
      setOpen(false)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save changes")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Edit game")}
          >
            <PencilIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{game.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{game.slug}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex flex-col gap-4">
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`game-name-${game.id}`}>
                {t("Name")}
              </FieldLabel>
              <Input
                id={`game-name-${game.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`game-release-${game.id}`}>
                {t("Release date")}
              </FieldLabel>
              <Input
                id={`game-release-${game.id}`}
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              disabled={saving || name.trim().length === 0}
              className="self-end"
            >
              {t("Save")}
            </Button>
          </form>

          <div className="border-border flex flex-col gap-2 border-t pt-4">
            <span className="text-sm font-semibold">{t("Artwork")}</span>
            <div className="grid grid-cols-2 gap-2">
              {ASSET_FIELDS.map((asset) => (
                <GameAssetField
                  key={asset.role}
                  game={game}
                  role={asset.role}
                  label={asset.label}
                />
              ))}
            </div>
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose
            render={<Button type="button">{t("Done")}</Button>}
          />
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

const GAME_ASSET_URL: Record<GameAssetRole, keyof AdminGameRow> = {
  grid: "gridUrl",
  hero: "heroUrl",
  logo: "logoUrl",
  icon: "iconUrl",
}

function GameAssetField({
  game,
  role,
  label,
}: {
  game: AdminGameRow
  role: GameAssetRole
  label: string
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const currentUrl = game[GAME_ASSET_URL[role]] as string | null

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const updated = await api.admin.uploadGameAsset(game.id, role, file)
      setAdminGameCacheRow(qc, updated)
      toast.success(t("Artwork updated"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't upload artwork")))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      const updated = await api.admin.deleteGameAsset(game.id, role)
      setAdminGameCacheRow(qc, updated)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't remove artwork")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-border flex items-center gap-2 rounded-md border p-2">
      <GameIcon
        src={currentUrl}
        name={label}
        className="size-8 shrink-0 rounded [&_img]:object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold">{label}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Upload {label}", { label })}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Spinner className="size-3.5" /> : <UploadIcon />}
          </Button>
          {currentUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Remove {label}", { label })}
              disabled={busy}
              onClick={clear}
            >
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
