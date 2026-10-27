import type {
  AdminGameRow,
  AdminUpdateGameInput,
  GameAssetRole,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { DatePicker } from "@alloy/ui/components/date-picker"
import { Field, FieldError, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import { cn } from "@alloy/ui/lib/utils"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"
import type { FormEvent, ReactNode } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import { AdminDialogFooter } from "./admin-dialog-footer"
import {
  dateInputValue,
  GAME_ASSET_ROLES,
  GAME_ASSET_URL,
  releaseDatePayload,
  setAdminGameCacheRow,
} from "./admin-game-data"
import { GameArtworkEditor } from "./game-artwork-editor"
import { SteamGridDBArtworkGrid } from "./steamgriddb-artwork-grid"

const PREVIEW_LABEL = "game artwork preview"

/**
 * An artwork change waiting for the dialog's save. Nothing reaches the server
 * until then, so cancelling the dialog discards every slot at once. A staged
 * file carries the blob URL its tile previews, revoked when the file leaves.
 */
type StagedArtwork =
  | { kind: "file"; file: File; preview: string | null }
  | { kind: "url"; url: string; preview: string }
  | { kind: "remove" }

type StagedArtworkMap = Partial<Record<GameAssetRole, StagedArtwork>>

type CreateGameValues = {
  name: string
  releaseDate: string
  staged: StagedArtworkMap
}

type EditGameValues = CreateGameValues & { slug: string }

const NEW_GAME: CreateGameValues = { name: "", releaseDate: "", staged: {} }

function stagedFile(file: File): StagedArtwork {
  return { kind: "file", file, preview: createObjectUrl(file, PREVIEW_LABEL) }
}

function releasePreview(change: StagedArtwork | undefined) {
  if (change?.kind === "file") revokeObjectUrl(change.preview, PREVIEW_LABEL)
}

/**
 * Swaps one staged slot. Call it from event handlers, never from a state
 * updater: it revokes the replaced file's preview URL.
 */
function restage(
  staged: StagedArtworkMap,
  role: GameAssetRole,
  change: StagedArtwork | null,
) {
  if (staged[role] !== change) releasePreview(staged[role])
  const next = { ...staged }
  if (change) next[role] = change
  else delete next[role]
  return next
}

/** Revokes the previews still staged when the dialog content unmounts. */
function useReleaseStagedPreviews(staged: () => StagedArtworkMap) {
  const read = useEffectEvent(staged)
  useEffect(
    () => () => {
      for (const change of Object.values(read())) releasePreview(change)
    },
    [],
  )
}

export function CreateGameDialog() {
  const [open, setOpen] = useState(false)

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("Add game")}
          >
            <PlusIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent className="md:max-w-[640px]">
        <CreateGameForm onCreated={() => setOpen(false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/** Lives inside the dialog content, so each open starts from a blank draft. */
function CreateGameForm({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<GameAssetRole>("grid")
  const create = useMutation({
    mutationFn: api.admin.createGame,
    onSuccess: (created) => {
      setAdminGameCacheRow(queryClient, created)
      onCreated()
    },
  })
  const saving = create.isPending
  const form = useForm({
    defaultValues: NEW_GAME,
    onSubmit: ({ value }) => {
      const trimmed = value.name.trim()
      if (!trimmed || saving) return
      const assets: Partial<Record<GameAssetRole, File>> = {}
      for (const role of GAME_ASSET_ROLES) {
        const change = value.staged[role]
        if (change?.kind === "file") assets[role] = change.file
      }
      create.mutate({
        name: trimmed,
        releaseDate: releaseDatePayload(value.releaseDate),
        assets,
      })
    },
  })
  const values = useStore(form.store, (state) => state.values)
  useReleaseStagedPreviews(() => form.getFieldValue("staged"))
  const submitError = create.error
    ? errorMessage(create.error, t("Couldn't create game"))
    : null

  const stage = (role: GameAssetRole, change: StagedArtwork | null) => {
    form.setFieldValue(
      "staged",
      restage(form.getFieldValue("staged"), role, change),
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t("New custom game")}</ResponsiveDialogTitle>
      </ResponsiveDialogHeader>
      <GameEditorBody error={submitError}>
        <GameDetailFields
          idPrefix="new-game"
          name={values.name}
          onNameChange={(name) => form.setFieldValue("name", name)}
          releaseDate={values.releaseDate}
          onReleaseDateChange={(date) =>
            form.setFieldValue("releaseDate", date)
          }
        />
        <GameArtworkEditor
          role={role}
          onRoleChange={setRole}
          src={(role) => {
            const change = values.staged[role]
            return change && change.kind !== "remove" ? change.preview : null
          }}
          // Everything in a new game is unsaved, so the marker says nothing.
          changed={() => false}
          disabled={saving}
          onFile={(role, file) => stage(role, stagedFile(file))}
          onRemove={(role) => stage(role, null)}
        />
      </GameEditorBody>
      <AdminDialogFooter
        pending={saving}
        failed={Boolean(submitError)}
        disabled={values.name.trim().length === 0}
        pendingLabel={t("Creating…")}
      >
        {t("Create")}
      </AdminDialogFooter>
    </form>
  )
}

export function EditGameDialog({ game }: { game: AdminGameRow }) {
  const [open, setOpen] = useState(false)

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
            <PencilIcon className="size-3.5" />
          </Button>
        }
      />
      <ResponsiveDialogContent className="md:max-w-[640px]">
        <EditGameForm game={game} onSaved={() => setOpen(false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/**
 * Seeds from the game when the dialog opens. It is not keyed on the game: the
 * cache updates the row mid-save, and the draft must keep diffing against it.
 */
function EditGameForm({
  game,
  onSaved,
}: {
  game: AdminGameRow
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<GameAssetRole>("grid")
  const defaultValues: EditGameValues = {
    name: game.name,
    slug: game.slug,
    releaseDate: dateInputValue(game.releaseDate),
    staged: {},
  }
  const form = useForm({ defaultValues })
  const save = useMutation({
    mutationFn: async ({
      patch,
      uploads,
    }: {
      patch: AdminUpdateGameInput
      uploads: StagedArtworkMap
    }) => {
      if (Object.keys(patch).length > 0) {
        setAdminGameCacheRow(
          queryClient,
          await api.admin.updateGame(game.id, patch),
        )
        form.setFieldValue("staged", uploads)
      }
      for (const role of GAME_ASSET_ROLES) {
        const upload = uploads[role]
        if (upload?.kind !== "file") continue
        setAdminGameCacheRow(
          queryClient,
          await api.admin.uploadGameAsset(game.id, role, upload.file),
        )
        form.setFieldValue(
          "staged",
          restage(form.getFieldValue("staged"), role, null),
        )
      }
    },
    onSuccess: onSaved,
  })
  const saving = save.isPending
  const values = useStore(form.store, (state) => state.values)
  const { staged } = values
  useReleaseStagedPreviews(() => form.getFieldValue("staged"))
  const saveError = save.error
    ? errorMessage(save.error, t("Couldn't save changes"))
    : null

  // SAFETY: GAME_ASSET_URL maps only to nullable URL fields.
  const liveUrl = (role: GameAssetRole) =>
    game[GAME_ASSET_URL[role]] as string | null

  const slotSrc = (role: GameAssetRole) => {
    const change = staged[role]
    if (!change) return liveUrl(role)
    return change.kind === "remove" ? null : change.preview
  }

  const stage = (role: GameAssetRole, change: StagedArtwork | null) => {
    form.setFieldValue(
      "staged",
      restage(form.getFieldValue("staged"), role, change),
    )
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
  const trimmedName = values.name.trim()
  const trimmedSlug = values.slug.trim()
  const details: AdminUpdateGameInput = {}
  if (trimmedName !== game.name) details.name = trimmedName
  if (trimmedSlug !== game.slug) details.slug = trimmedSlug
  if (values.releaseDate !== dateInputValue(game.releaseDate)) {
    details.releaseDate = releaseDatePayload(values.releaseDate)
  }
  const dirty =
    Object.keys(details).length > 0 || Object.keys(staged).length > 0

  const handleSave = (event: FormEvent) => {
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
    save.mutate({ patch, uploads })
  }

  return (
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
          name={values.name}
          onNameChange={(name) => form.setFieldValue("name", name)}
          slug={values.slug}
          onSlugChange={(slug) => form.setFieldValue("slug", slug)}
          releaseDate={values.releaseDate}
          onReleaseDateChange={(date) =>
            form.setFieldValue("releaseDate", date)
          }
        />
        <GameArtworkEditor
          role={role}
          onRoleChange={setRole}
          src={slotSrc}
          changed={(role) => staged[role] !== undefined}
          disabled={saving}
          onFile={(role, file) => stage(role, stagedFile(file))}
          onRemove={(role) =>
            // With nothing saved in the slot, removing only undoes the staged
            // pick.
            stage(role, liveUrl(role) ? { kind: "remove" } : null)
          }
        >
          {game.steamgriddbId === null ? null : (
            <SteamGridDBArtworkGrid
              gameId={game.id}
              role={role}
              selectedUrl={selectedUrl}
              disabled={saving}
              onPick={(asset) =>
                stage(
                  role,
                  // Picking what is already saved undoes the staged change
                  // instead of rewriting it.
                  asset.url === liveUrl(role)
                    ? null
                    : {
                        kind: "url",
                        url: asset.url,
                        preview: asset.thumb ?? asset.url,
                      },
                )
              }
            />
          )}
        </GameArtworkEditor>
      </GameEditorBody>
      <AdminDialogFooter
        pending={saving}
        failed={Boolean(saveError)}
        disabled={!trimmedName || !trimmedSlug || !dirty}
        pendingLabel={t("Saving…")}
      >
        {t("Save")}
      </AdminDialogFooter>
    </form>
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
      <ResponsiveDialogBody className="flex flex-col gap-4 md:my-3 md:max-h-[70vh] md:overflow-y-auto md:py-1">
        {children}
      </ResponsiveDialogBody>
      {error ? (
        <FieldError className="px-4 pb-3 md:px-6">{error}</FieldError>
      ) : null}
    </>
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
