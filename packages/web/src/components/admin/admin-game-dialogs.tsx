import type { AdminGameRow, GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { DatePicker } from "@alloy/ui/components/date-picker"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { GameIcon } from "@alloy/ui/components/game-icon"
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
import {
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import {
  dateInputValue,
  GAME_ASSET_FIELDS,
  GAME_ASSET_URL,
  releaseDatePayload,
  setAdminGameCacheRow,
} from "./admin-game-data"

export function CreateGameDialog() {
  const queryClient = useQueryClient()
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
          <Button type="button">
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
                  {t("Optional — each role has its own shape.")}
                </span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {GAME_ASSET_FIELDS.map((asset) => (
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

export function EditGameDialog({ game }: { game: AdminGameRow }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(game.name)
  const [releaseDate, setReleaseDate] = useState(
    dateInputValue(game.releaseDate),
  )
  const [saving, setSaving] = useState(false)

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
                {t(
                  "Each role has its own shape — the preview shows what's live.",
                )}
              </span>
            </div>
            <div className="grid gap-2.5 md:grid-cols-2">
              {GAME_ASSET_FIELDS.map((asset) => (
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

function AssetFieldCard({
  label,
  description,
  status,
  preview,
  primaryLabel,
  primaryIcon,
  primaryAriaLabel,
  primaryDisabled,
  showRemove,
  removeAriaLabel,
  removeDisabled,
  onRemove,
  onFileSelected,
}: {
  label: string
  description: string
  status: string
  preview: ReactNode
  primaryLabel: string
  primaryIcon: ReactNode
  primaryAriaLabel: string
  primaryDisabled?: boolean
  showRemove: boolean
  removeAriaLabel: string
  removeDisabled?: boolean
  onRemove: () => void
  onFileSelected: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Card className="gap-3 p-3">
      <div className="border-border bg-surface-sunken flex h-28 items-center justify-center overflow-hidden rounded-md border">
        {preview}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-none font-semibold">{label}</span>
          <span className="text-foreground-muted truncate text-xs">
            {description}
          </span>
          <span className="text-foreground-faint truncate text-xs">
            {status}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={primaryAriaLabel}
            disabled={primaryDisabled}
            onClick={() => inputRef.current?.click()}
          >
            {primaryIcon}
            {primaryLabel}
          </Button>
          {showRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={removeAriaLabel}
              disabled={removeDisabled}
              onClick={onRemove}
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
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) onFileSelected(file)
        }}
      />
    </Card>
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
    <AssetFieldCard
      label={label}
      description={description}
      status={file ? file.name : t("Not set")}
      preview={
        previewUrl ? (
          <img src={previewUrl} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="text-foreground-faint size-5" aria-hidden />
        )
      }
      primaryLabel={file ? t("Replace") : t("Choose")}
      primaryIcon={<UploadIcon />}
      primaryAriaLabel={t("Choose {label}", { label })}
      showRemove={file !== null}
      removeAriaLabel={t("Remove {label}", { label })}
      onRemove={() => onSelect(null)}
      onFileSelected={(next) => onSelect(next)}
    />
  )
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
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const currentUrl = game[GAME_ASSET_URL[role]] as string | null

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const updated = await api.admin.uploadGameAsset(game.id, role, file)
      setAdminGameCacheRow(queryClient, updated)
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
      setAdminGameCacheRow(queryClient, updated)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't remove artwork")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AssetFieldCard
      label={label}
      description={description}
      status={currentUrl ? t("Uploaded") : t("Not set")}
      preview={
        currentUrl ? (
          <GameIcon
            src={currentUrl}
            name={game.name}
            className="size-full rounded-none"
          />
        ) : (
          <ImageIcon className="text-foreground-faint size-5" aria-hidden />
        )
      }
      primaryLabel={currentUrl ? t("Replace") : t("Upload")}
      primaryIcon={busy ? <Spinner className="size-3.5" /> : <UploadIcon />}
      primaryAriaLabel={t("Upload {label}", { label })}
      primaryDisabled={busy}
      showRemove={currentUrl !== null}
      removeAriaLabel={t("Remove {label}", { label })}
      removeDisabled={busy}
      onRemove={clear}
      onFileSelected={(file) => void upload(file)}
    />
  )
}
