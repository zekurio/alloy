import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { DatePicker } from "@alloy/ui/components/date-picker"
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
import {
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"

import { adminGamesQueryOptions, adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

const ASSET_FIELDS: {
  role: GameAssetRole
  label: string
  description: string
}[] = [
  { role: "grid", label: t("Cover"), description: t("Vertical box art") },
  { role: "hero", label: t("Banner"), description: t("Wide page header") },
  { role: "logo", label: t("Logo"), description: t("Transparent wordmark") },
  { role: "icon", label: t("Icon"), description: t("Square app tile") },
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

  const summary =
    games && games.length > 0
      ? games.length === 1
        ? t("{count} game", { count: games.length })
        : t("{count} games", { count: games.length })
      : null

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        {hideHeader ? (
          <span className="text-foreground-muted text-sm tabular-nums">
            {summary}
          </span>
        ) : (
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
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.admin.deleteGame(game.id)
      removeAdminGameCacheRow(qc, game.id)
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
    <div className="border-border bg-surface-raised/40 flex flex-col gap-3 rounded-lg border p-3">
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
        {ASSET_FIELDS.map((asset) => {
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
    </div>
  )
}

function CreateGameDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [assets, setAssets] = useState<Partial<Record<GameAssetRole, File>>>({})
  const [saving, setSaving] = useState(false)

  const setAsset = (role: GameAssetRole, file: File | null) => {
    setAssets((old) => {
      const next = { ...old }
      if (file) next[role] = file
      else delete next[role]
      return next
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const created = await api.admin.createGame({
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
        assets,
      })
      setAdminGameCacheRow(qc, created)
      toast.success(t("Game created"))
      setName("")
      setReleaseDate("")
      setAssets({})
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
      <ResponsiveDialogContent className="md:max-w-[640px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("New custom game")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("Name the game and attach its artwork in one step.")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4 md:max-h-[70vh] md:overflow-y-auto">
            <div className="grid gap-4 md:grid-cols-2">
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
                <DatePicker
                  id="new-game-release"
                  value={releaseDate}
                  onValueChange={setReleaseDate}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{t("Artwork")}</span>
                <span className="text-foreground-muted text-xs">
                  {t("Optional — each role has its own shape.")}
                </span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {ASSET_FIELDS.map((asset) => (
                  <CreateGameAssetField
                    key={asset.role}
                    role={asset.role}
                    label={asset.label}
                    description={asset.description}
                    file={assets[asset.role] ?? null}
                    onSelect={(file) => setAsset(asset.role, file)}
                  />
                ))}
              </div>
            </div>
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
              {saving ? <Spinner className="size-3.5" /> : null}
              {t("Create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function CreateGameAssetField({
  role,
  label,
  description,
  file,
  onSelect,
}: {
  role: GameAssetRole
  label: string
  description: string
  file: File | null
  onSelect: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = createObjectUrl(file, `game ${role} preview`)
    setPreviewUrl(url)
    return () => revokeObjectUrl(url, `game ${role} preview`)
  }, [file, role])

  return (
    <div className="border-border bg-surface-raised/40 flex flex-col gap-3 rounded-lg border p-3">
      <div className="border-border bg-surface-sunken flex h-28 items-center justify-center overflow-hidden rounded-md border">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="text-foreground-faint size-5" aria-hidden />
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-none font-semibold">{label}</span>
          <span className="text-foreground-muted truncate text-xs">
            {description}
          </span>
          <span className="text-foreground-faint truncate text-xs">
            {file ? file.name : t("Not set")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={t("Choose {label}", { label })}
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon />
            {file ? t("Replace") : t("Choose")}
          </Button>
          {file ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("Remove {label}", { label })}
              onClick={() => onSelect(null)}
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
          const next = e.target.files?.[0]
          e.target.value = ""
          if (next) onSelect(next)
        }}
      />
    </div>
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
      <ResponsiveDialogContent className="md:max-w-[640px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{game.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{game.slug}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex flex-col gap-4 md:max-h-[70vh] md:overflow-y-auto">
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
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
                <DatePicker
                  id={`game-release-${game.id}`}
                  value={releaseDate}
                  onValueChange={setReleaseDate}
                />
              </Field>
            </div>
            <Button
              type="submit"
              disabled={saving || name.trim().length === 0}
              className="self-end"
            >
              {t("Save")}
            </Button>
          </form>

          <div className="border-border flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{t("Artwork")}</span>
              <span className="text-foreground-muted text-xs">
                {t(
                  "Each role has its own shape — the preview shows what's live.",
                )}
              </span>
            </div>
            <div className="grid gap-2.5 md:grid-cols-2">
              {ASSET_FIELDS.map((asset) => (
                <GameAssetField
                  key={asset.role}
                  game={game}
                  role={asset.role}
                  label={asset.label}
                  description={asset.description}
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
  description,
}: {
  game: AdminGameRow
  role: GameAssetRole
  label: string
  description: string
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
    <div className="border-border bg-surface-raised/40 flex flex-col gap-3 rounded-lg border p-3">
      <div className="border-border bg-surface-sunken flex h-28 items-center justify-center overflow-hidden rounded-md border">
        {currentUrl ? (
          <GameIcon
            src={currentUrl}
            name={game.name}
            className="size-full rounded-none"
          />
        ) : (
          <ImageIcon className="text-foreground-faint size-5" aria-hidden />
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-none font-semibold">{label}</span>
          <span className="text-foreground-muted truncate text-xs">
            {description}
          </span>
          <span className="text-foreground-faint text-xs">
            {currentUrl ? t("Uploaded") : t("Not set")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={t("Upload {label}", { label })}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Spinner className="size-3.5" /> : <UploadIcon />}
            {currentUrl ? t("Replace") : t("Upload")}
          </Button>
          {currentUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
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
