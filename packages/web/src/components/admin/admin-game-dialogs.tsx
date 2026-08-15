import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { DatePicker } from "@alloy/ui/components/date-picker"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
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
  setAdminGameArtworkRow,
  setAdminGameCacheRow,
} from "./admin-game-data"
import { GameArtworkStencil } from "./game-artwork-stencil"
import type { GameArtworkSlot } from "./game-artwork-stencil"

export function CreateGameDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [assets, setAssets] = useState<Partial<Record<GameAssetRole, File>>>({})
  const previews = useAssetPreviews(assets)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
    setSubmitError(null)
    setSaving(true)
    try {
      const created = await api.admin.createGame({
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
        assets,
      })
      setAdminGameCacheRow(queryClient, created)
      setName("")
      setReleaseDate("")
      setAssets({})
      setOpen(false)
    } catch (cause) {
      setSubmitError(errorMessage(cause, t("Couldn't create game")))
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
            <GameDetailFields
              nameId="new-game-name"
              releaseDateId="new-game-release"
              name={name}
              onNameChange={setName}
              releaseDate={releaseDate}
              onReleaseDateChange={setReleaseDate}
            />
            <GameArtworkSection
              className="flex flex-col gap-3"
              hint={t("Optional — click a slot to fill it in.")}
              name={name}
              releaseDate={releaseDate}
              slot={(role) => ({
                src: previews[role] ?? null,
                onSelect: (file) => setAsset(role, file),
                onRemove: () => setAsset(role, null),
              })}
            />
            <FieldError>{submitError}</FieldError>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button type="button" variant="ghost">
                  {t("Cancel")}
                </Button>
              }
            />
            <FeedbackButton
              type="submit"
              state={saving ? "pending" : submitError ? "error" : "idle"}
              pendingLabel={t("Creating…")}
              errorLabel={t("Try again")}
              disabled={saving || name.trim().length === 0}
            >
              {t("Create")}
            </FeedbackButton>
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [artworkError, setArtworkError] = useState<string | null>(null)
  // Artwork applies immediately, and slots are independent: a logo upload can
  // still be in flight while a hero crop applies, so busy is tracked per role.
  const [busyRoles, setBusyRoles] = useState<ReadonlySet<GameAssetRole>>(
    new Set(),
  )

  const setRoleBusy = (role: GameAssetRole, busy: boolean) => {
    setBusyRoles((old) => {
      const next = new Set(old)
      if (busy) next.add(role)
      else next.delete(role)
      return next
    })
  }

  // Cropped uploads rethrow so the foreground crop dialog can show the error
  // and stay open for a retry. The artwork field also retains the message for
  // direct uploads such as logos.
  const uploadAsset = async (role: GameAssetRole, file: File) => {
    setArtworkError(null)
    setRoleBusy(role, true)
    try {
      setAdminGameArtworkRow(
        queryClient,
        await api.admin.uploadGameAsset(game.id, role, file),
      )
      return true
    } catch (cause) {
      const message = errorMessage(cause, t("Couldn't upload artwork"))
      setArtworkError(message)
      throw new Error(message)
    } finally {
      setRoleBusy(role, false)
    }
  }

  const clearAsset = async (role: GameAssetRole) => {
    setArtworkError(null)
    setRoleBusy(role, true)
    try {
      setAdminGameArtworkRow(
        queryClient,
        await api.admin.deleteGameAsset(game.id, role),
      )
    } catch (cause) {
      setArtworkError(errorMessage(cause, t("Couldn't remove artwork")))
    } finally {
      setRoleBusy(role, false)
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaveError(null)
    setSaving(true)
    try {
      const updated = await api.admin.updateGame(game.id, {
        name: trimmed,
        releaseDate: releaseDatePayload(releaseDate),
      })
      setAdminGameCacheRow(queryClient, updated)
      setOpen(false)
    } catch (cause) {
      setSaveError(errorMessage(cause, t("Couldn't save changes")))
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
            <GameDetailFields
              nameId={`game-name-${game.id}`}
              releaseDateId={`game-release-${game.id}`}
              name={name}
              onNameChange={setName}
              releaseDate={releaseDate}
              onReleaseDateChange={setReleaseDate}
            />
            <FieldError>{saveError}</FieldError>
            <FeedbackButton
              type="submit"
              state={saving ? "pending" : saveError ? "error" : "idle"}
              pendingLabel={t("Saving…")}
              errorLabel={t("Try again")}
              disabled={saving || name.trim().length === 0}
              className="self-end"
            >
              {t("Save")}
            </FeedbackButton>
          </form>

          <GameArtworkSection
            className="border-border flex flex-col gap-3 border-t pt-4"
            hint={t("Click a slot to replace or remove what's live.")}
            name={name}
            releaseDate={releaseDate}
            slot={(role) => ({
              // SAFETY: GAME_ASSET_URL maps only to nullable URL fields.
              src: game[GAME_ASSET_URL[role]] as string | null,
              busy: busyRoles.has(role),
              // Returned, not fired and forgotten: the crop dialog stays on
              // "Applying…" until the upload lands.
              onSelect: (file) => uploadAsset(role, file),
              onRemove: () => void clearAsset(role),
            })}
          />
          <FieldError>{artworkError}</FieldError>
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

function GameDetailFields({
  nameId,
  releaseDateId,
  name,
  onNameChange,
  releaseDate,
  onReleaseDateChange,
}: {
  nameId: string
  releaseDateId: string
  name: string
  onNameChange: (value: string) => void
  releaseDate: string
  onReleaseDateChange: (value: string) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={nameId}>{t("Name")}</FieldLabel>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={120}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={releaseDateId}>{t("Release date")}</FieldLabel>
        <DatePicker
          id={releaseDateId}
          value={releaseDate}
          onValueChange={onReleaseDateChange}
        />
      </Field>
    </div>
  )
}

function GameArtworkSection({
  className,
  hint,
  name,
  releaseDate,
  slot,
}: {
  className: string
  hint: string
  name: string
  releaseDate: string
  slot: (role: GameAssetRole) => GameArtworkSlot
}) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{t("Artwork")}</span>
        <span className="text-foreground-muted text-xs">{hint}</span>
      </div>
      <GameArtworkStencil name={name} releaseDate={releaseDate} slot={slot} />
    </div>
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
