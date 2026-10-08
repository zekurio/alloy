import type {
  AdminGameRow,
  AdminUpdateGameInput,
  GameAssetRole,
} from "@alloy/api"
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
import { cn } from "@alloy/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent, ReactNode } from "react"

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
import { GameArtworkEditor } from "./game-artwork-editor"
import { SteamGridDBArtworkGrid } from "./steamgriddb-artwork-grid"

/**
 * An artwork change waiting for the dialog's save. Nothing reaches the server
 * until then, so cancelling the dialog discards every slot at once.
 */
type StagedArtwork =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string; preview: string }
  | { kind: "remove" }

type StagedArtworkMap = Partial<Record<GameAssetRole, StagedArtwork>>

function withStaged(
  staged: StagedArtworkMap,
  role: GameAssetRole,
  change: StagedArtwork | null,
) {
  const next = { ...staged }
  if (change) next[role] = change
  else delete next[role]
  return next
}

export function CreateGameDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [staged, setStaged] = useState<StagedArtworkMap>({})
  const [role, setRole] = useState<GameAssetRole>("grid")
  const previews = useFilePreviews(staged)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    const assets: Partial<Record<GameAssetRole, File>> = {}
    for (const role of GAME_ASSET_ROLES) {
      const change = staged[role]
      if (change?.kind === "file") assets[role] = change.file
    }
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
      setStaged({})
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
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t("New custom game")}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <GameEditorBody error={submitError}>
            <GameDetailFields
              idPrefix="new-game"
              name={name}
              onNameChange={setName}
              releaseDate={releaseDate}
              onReleaseDateChange={setReleaseDate}
            />
            <GameArtworkEditor
              role={role}
              onRoleChange={setRole}
              src={(role) => previews[role] ?? null}
              // Everything in a new game is unsaved, so the marker says nothing.
              changed={() => false}
              disabled={saving}
              onFile={(role, file) =>
                setStaged((old) =>
                  withStaged(old, role, { kind: "file", file }),
                )
              }
              onRemove={(role) =>
                setStaged((old) => withStaged(old, role, null))
              }
            />
          </GameEditorBody>
          <GameDialogFooter
            saving={saving}
            failed={Boolean(submitError)}
            canSubmit={name.trim().length > 0}
            label={t("Create")}
            pendingLabel={t("Creating…")}
          />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function EditGameDialog({ game }: { game: AdminGameRow }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(game.name)
  const [slug, setSlug] = useState(game.slug)
  const [releaseDate, setReleaseDate] = useState(
    dateInputValue(game.releaseDate),
  )
  const [staged, setStaged] = useState<StagedArtworkMap>({})
  const [role, setRole] = useState<GameAssetRole>("grid")
  const previews = useFilePreviews(staged)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // SAFETY: GAME_ASSET_URL maps only to nullable URL fields.
  const liveUrl = (role: GameAssetRole) =>
    game[GAME_ASSET_URL[role]] as string | null

  const slotSrc = (role: GameAssetRole) => {
    const change = staged[role]
    if (!change) return liveUrl(role)
    if (change.kind === "file") return previews[role] ?? null
    return change.kind === "url" ? change.preview : null
  }

  // What the selected slot would hold once saved, if it is a remote image.
  const selectedChange = staged[role]
  const selectedUrl = selectedChange
    ? selectedChange.kind === "url"
      ? selectedChange.url
      : null
    : liveUrl(role)

  // Only what differs is sent: any write marks the game as customized, which
  // ends its automatic SteamGridDB refreshes.
  const trimmedName = name.trim()
  const trimmedSlug = slug.trim()
  const details: AdminUpdateGameInput = {}
  if (trimmedName !== game.name) details.name = trimmedName
  if (trimmedSlug !== game.slug) details.slug = trimmedSlug
  if (releaseDate !== dateInputValue(game.releaseDate)) {
    details.releaseDate = releaseDatePayload(releaseDate)
  }
  const dirty =
    Object.keys(details).length > 0 || Object.keys(staged).length > 0

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmedName || !trimmedSlug || saving || !dirty) return
    // Details, SteamGridDB picks and removals share one request; only uploads
    // need their own. Each step clears what it saved, so a failure partway
    // leaves exactly the unsaved changes staged for a retry.
    const patch = { ...details }
    const uploads: StagedArtworkMap = {}
    for (const role of GAME_ASSET_ROLES) {
      const change = staged[role]
      if (!change) continue
      if (change.kind === "file") uploads[role] = change
      else {
        patch[GAME_ASSET_URL[role]] = change.kind === "url" ? change.url : null
      }
    }

    setSaveError(null)
    setSaving(true)
    try {
      if (Object.keys(patch).length > 0) {
        setAdminGameCacheRow(
          queryClient,
          await api.admin.updateGame(game.id, patch),
        )
        setStaged(uploads)
      }
      for (const role of GAME_ASSET_ROLES) {
        const upload = uploads[role]
        if (upload?.kind !== "file") continue
        setAdminGameCacheRow(
          queryClient,
          await api.admin.uploadGameAsset(game.id, role, upload.file),
        )
        setStaged((old) => withStaged(old, role, null))
      }
      setOpen(false)
    } catch (cause) {
      setSaveError(errorMessage(cause, t("Couldn't save changes")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setName(game.name)
          setSlug(game.slug)
          setReleaseDate(dateInputValue(game.releaseDate))
          setStaged({})
          setSaveError(null)
        }
        setOpen(nextOpen)
      }}
    >
      <ResponsiveDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Edit game")}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      />
      <ResponsiveDialogContent className="md:max-w-[640px]">
        <form onSubmit={handleSave}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t("Edit game")}</ResponsiveDialogTitle>
            {game.source === "steamgriddb" ? (
              <ResponsiveDialogDescription>
                {t(
                  "Customizations stop automatic SteamGridDB updates for this game.",
                )}
              </ResponsiveDialogDescription>
            ) : null}
          </ResponsiveDialogHeader>
          <GameEditorBody error={saveError}>
            <GameDetailFields
              idPrefix={`game-${game.id}`}
              name={name}
              onNameChange={setName}
              slug={slug}
              onSlugChange={setSlug}
              releaseDate={releaseDate}
              onReleaseDateChange={setReleaseDate}
            />
            <GameArtworkEditor
              role={role}
              onRoleChange={setRole}
              src={slotSrc}
              changed={(role) => staged[role] !== undefined}
              disabled={saving}
              onFile={(role, file) =>
                setStaged((old) =>
                  withStaged(old, role, { kind: "file", file }),
                )
              }
              onRemove={(role) =>
                setStaged((old) =>
                  // With nothing saved in the slot, removing only undoes the
                  // staged pick.
                  withStaged(
                    old,
                    role,
                    liveUrl(role) ? { kind: "remove" } : null,
                  ),
                )
              }
            >
              {game.steamgriddbId === null ? null : (
                <SteamGridDBArtworkGrid
                  gameId={game.id}
                  role={role}
                  selectedUrl={selectedUrl}
                  disabled={saving}
                  onPick={(asset) =>
                    setStaged((old) =>
                      withStaged(
                        old,
                        role,
                        // Picking what is already saved undoes the staged
                        // change instead of rewriting it.
                        asset.url === liveUrl(role)
                          ? null
                          : {
                              kind: "url",
                              url: asset.url,
                              preview: asset.thumb ?? asset.url,
                            },
                      ),
                    )
                  }
                />
              )}
            </GameArtworkEditor>
          </GameEditorBody>
          <GameDialogFooter
            saving={saving}
            failed={Boolean(saveError)}
            canSubmit={Boolean(trimmedName && trimmedSlug && dirty)}
            label={t("Save")}
            pendingLabel={t("Saving…")}
          />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/**
 * The scrolling part of both game dialogs. The error sits below the scroll
 * area, next to the button that caused it, so a long artwork list can't push
 * it out of view.
 */
function GameEditorBody({
  error,
  children,
}: {
  error: string | null
  children: ReactNode
}) {
  return (
    <>
      <ResponsiveDialogBody className="flex flex-col gap-4 md:max-h-[70vh] md:overflow-y-auto">
        {children}
      </ResponsiveDialogBody>
      {error ? (
        <FieldError className="px-4 pb-3 md:px-6">{error}</FieldError>
      ) : null}
    </>
  )
}

/** Cancel and submit, shared by both game dialogs. */
function GameDialogFooter({
  saving,
  failed,
  canSubmit,
  label,
  pendingLabel,
}: {
  saving: boolean
  failed: boolean
  canSubmit: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <ResponsiveDialogFooter>
      <ResponsiveDialogClose
        render={
          <Button type="button" variant="ghost" disabled={saving}>
            {t("Cancel")}
          </Button>
        }
      />
      <FeedbackButton
        type="submit"
        state={saving ? "pending" : failed ? "error" : "idle"}
        pendingLabel={pendingLabel}
        errorLabel={t("Try again")}
        disabled={saving || !canSubmit}
      >
        {label}
      </FeedbackButton>
    </ResponsiveDialogFooter>
  )
}

function GameDetailFields({
  idPrefix,
  name,
  onNameChange,
  slug,
  onSlugChange,
  releaseDate,
  onReleaseDateChange,
}: {
  idPrefix: string
  name: string
  onNameChange: (value: string) => void
  /** Only existing games have a slug to edit; new ones get theirs derived. */
  slug?: string
  onSlugChange?: (value: string) => void
  releaseDate: string
  onReleaseDateChange: (value: string) => void
}) {
  const hasSlug = slug !== undefined
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
      <Field className={cn("col-span-2", hasSlug && "md:col-span-1")}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{t("Name")}</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={120}
          required
        />
      </Field>
      {hasSlug ? (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-slug`}>{t("Slug")}</FieldLabel>
          <Input
            id={`${idPrefix}-slug`}
            value={slug}
            onChange={(event) => onSlugChange?.(event.target.value)}
            maxLength={64}
            required
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      ) : null}
      <Field className={cn(!hasSlug && "col-span-2 md:col-span-1")}>
        <FieldLabel htmlFor={`${idPrefix}-release`}>
          {t("Release date")}
        </FieldLabel>
        <DatePicker
          id={`${idPrefix}-release`}
          value={releaseDate}
          onValueChange={onReleaseDateChange}
        />
      </Field>
    </div>
  )
}

/**
 * Blob URLs for staged file uploads, rebuilt whenever a slot changes so the
 * artwork tiles show the pending image before it is uploaded.
 */
function useFilePreviews(staged: StagedArtworkMap) {
  const [previews, setPreviews] = useState<
    Partial<Record<GameAssetRole, string>>
  >({})

  useEffect(() => {
    const next: Partial<Record<GameAssetRole, string>> = {}
    for (const role of GAME_ASSET_ROLES) {
      const change = staged[role]
      if (change?.kind !== "file") continue
      const url = createObjectUrl(change.file, `game ${role} preview`)
      if (url) next[role] = url
    }
    setPreviews(next)
    return () => {
      for (const role of GAME_ASSET_ROLES) {
        revokeObjectUrl(next[role], `game ${role} preview`)
      }
    }
  }, [staged])

  return previews
}
