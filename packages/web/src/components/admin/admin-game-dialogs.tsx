import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { DatePicker } from "@alloy/ui/components/date-picker"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
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
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import {
  dateInputValue,
  GAME_ASSET_ROLES,
  GAME_ASSET_URL,
  releaseDatePayload,
  setAdminGameCacheRow,
} from "./admin-game-data"
import { GameArtworkStencil } from "./game-artwork-stencil"

export function CreateGameDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [assets, setAssets] = useState<Partial<Record<GameAssetRole, File>>>({})
  const previews = useAssetPreviews(assets)
  const [saving, setSaving] = useState(false)

  const setAsset = (role: GameAssetRole, file: File | null) => {
    setAssets((old) => {
      const next = { ...old }
      if (file) next[role] = file
      else delete next[role]
      return next
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const created = await api.admin.createGame({
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
        assets,
      })
      setAdminGameCacheRow(queryClient, created)
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
          <Button type="button" size="icon" aria-label={t("Add game")}>
            <PlusIcon />
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
                  onChange={(event) => setName(event.target.value)}
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
                  {t("Optional — click a slot to fill it in.")}
                </span>
              </div>
              <GameArtworkStencil
                name={name}
                releaseDate={releaseDate}
                slot={(role) => ({
                  src: previews[role] ?? null,
                  onSelect: (file) => setAsset(role, file),
                  onRemove: () => setAsset(role, null),
                })}
              />
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

export function EditGameDialog({ game }: { game: AdminGameRow }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(game.name)
  const [releaseDate, setReleaseDate] = useState(
    dateInputValue(game.releaseDate),
  )
  const [saving, setSaving] = useState(false)
  // Artwork applies immediately; only one slot is ever in flight at a time.
  const [busyRole, setBusyRole] = useState<GameAssetRole | null>(null)

  const uploadAsset = async (role: GameAssetRole, file: File) => {
    setBusyRole(role)
    try {
      setAdminGameCacheRow(
        queryClient,
        await api.admin.uploadGameAsset(game.id, role, file),
      )
      toast.success(t("Artwork updated"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't upload artwork")))
    } finally {
      setBusyRole(null)
    }
  }

  const clearAsset = async (role: GameAssetRole) => {
    setBusyRole(role)
    try {
      setAdminGameCacheRow(
        queryClient,
        await api.admin.deleteGameAsset(game.id, role),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't remove artwork")))
    } finally {
      setBusyRole(null)
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const updated = await api.admin.updateGame(game.id, {
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
      })
      setAdminGameCacheRow(queryClient, updated)
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
            size="icon-sm"
            aria-label={t("Edit game")}
          >
            <PencilIcon className="size-3.5" />
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
                  onChange={(event) => setName(event.target.value)}
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
                {t("Click a slot to replace or remove what's live.")}
              </span>
            </div>
            <GameArtworkStencil
              name={name}
              releaseDate={releaseDate}
              slot={(role) => ({
                src: game[GAME_ASSET_URL[role]] as string | null,
                busy: busyRole === role,
                // Returned, not fired and forgotten: the crop dialog stays on
                // "Applying…" until the upload lands.
                onSelect: (file) => uploadAsset(role, file),
                onRemove: () => void clearAsset(role),
              })}
            />
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

/**
 * Blob URLs for the files staged in the create dialog, rebuilt whenever a slot
 * changes so the stencil shows the pending artwork before it is uploaded.
 */
function useAssetPreviews(assets: Partial<Record<GameAssetRole, File>>) {
  const [previews, setPreviews] = useState<
    Partial<Record<GameAssetRole, string>>
  >({})

  useEffect(() => {
    const next: Partial<Record<GameAssetRole, string>> = {}
    for (const role of GAME_ASSET_ROLES) {
      const file = assets[role]
      if (!file) continue
      const url = createObjectUrl(file, `game ${role} preview`)
      if (url) next[role] = url
    }
    setPreviews(next)
    return () => {
      for (const role of GAME_ASSET_ROLES) {
        revokeObjectUrl(next[role], `game ${role} preview`)
      }
    }
  }, [assets])

  return previews
}
