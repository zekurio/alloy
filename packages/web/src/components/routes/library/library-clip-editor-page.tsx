import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Card } from "@alloy/ui/components/card"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { VideoOffIcon } from "lucide-react"
import { useCallback, useState } from "react"

import {
  MIN_TRIM_MS,
  sameTrimRange,
  toPersistedTrimRange,
  useTrimPlayback,
} from "@/components/clip-editor/use-trim-playback"
import { EmptyState } from "@/components/feedback/empty-state"
import { useSession } from "@/lib/auth-client"
import { clipEncodingActive } from "@/lib/clip-encoding"
import {
  invalidateClipCaches,
  removeClipDetailFromCache,
  seedClipDetailInCache,
  useClipQuery,
  useDeleteClipMutation,
  useTrimClipMutation,
} from "@/lib/clip-queries"
import { errorMessage } from "@/lib/error-message"

import { ClipEditorTabs } from "./library-clip-editor-details"
import {
  ClipEditorStage,
  useClipEditorMedia,
} from "./library-clip-editor-media"
import { MobileClipEditor } from "./library-clip-editor-mobile"
import { DeleteServerBackedDialog } from "./library-delete-dialog"
import { BackToLibraryButton } from "./library-editor-shared"
import {
  type NavigableLibraryEntry,
  useLibraryEditorShortcuts,
  useLibraryEntryNavigation,
  useNavigateToLibraryEntry,
} from "./library-entry-navigation"
import {
  type LibraryHandoffPoster,
  setLibraryHandoffPoster,
} from "./library-handoff-poster"
import { finishLocalClipDelete } from "./library-local-actions"

/**
 * Edit view for an already-uploaded clip: the same stage-and-trimmer layout
 * as the local capture editor on the left, and a Details / Comments tabbed
 * sheet on the right. Saving the trim cuts the clip's media on the server
 * and reprocesses it in place — id, comments, and likes survive.
 */
export function LibraryClipEditorPage({ clipId }: { clipId: string }) {
  const query = useClipQuery(clipId, { keepPreviousData: false })
  const row = query.data?.id === clipId ? query.data : undefined

  if (!row) {
    return (
      <AppMain>
        {query.isError ? (
          <EmptyState
            icon={VideoOffIcon}
            size="lg"
            fill
            title={t("Clip not found")}
            hint={t(
              "It may have been deleted, or you may not have access to it.",
            )}
            action={<BackToLibraryButton />}
          />
        ) : (
          <LoadingState className="py-16" />
        )}
      </AppMain>
    )
  }

  const mediaPending = row.status !== "ready"
  const processing = mediaPending || clipEncodingActive(row)

  return (
    <AppMain className="p-4 md:p-6">
      {/* Keyed by clip id: edits reset when navigating between clips, but
          survive background detail refetches. The processing key also resets
          playback when a newly published server preview takes over or a
          background re-encode commits replacement media. */}
      <ClipEditorBody
        key={`${row.id}:${processing ? "processing" : "ready"}`}
        row={row}
        processing={processing}
        mediaPending={mediaPending}
      />
    </AppMain>
  )
}

function ClipEditorBody({
  row,
  processing,
  mediaPending,
}: {
  row: ClipRow
  processing: boolean
  mediaPending: boolean
}) {
  // Matches the app shell's mobile breakpoint (the bottom nav takes over
  // below md), so the touch editor and the mobile chrome appear together.
  const desktopLayout = useMediaQuery("(min-width: 768px)")
  const navigation = useLibraryEntryNavigation({ type: "cloud", id: row.id })
  const { localItem, prevEntry, nextEntry } = navigation
  const { canManage, isOwner } = useClipEditorPermissions(row)
  const canTrim = isOwner && !processing
  // Before first publish, the stage plays the raw local capture. The
  // persisted trim bounds describe the exported upload's timeline, so
  // applying them to the raw file would seek the preview past its real start.
  const initialTrim =
    !mediaPending && row.trimStartMs !== null && row.trimEndMs !== null
      ? { startMs: row.trimStartMs, endMs: row.trimEndMs }
      : undefined
  const playback = useTrimPlayback({
    // The editor timeline is the uncut source's. durationMs (the cut's
    // length) understates it, so when the source duration is missing the
    // seeded trim must still fit — clamping bounds into the cut's shorter
    // timeline would corrupt them.
    initialDurationMs: Math.max(
      row.sourceDurationMs ?? row.durationMs ?? 0,
      initialTrim?.endMs ?? 0,
    ),
    initialTrim,
    canTrim,
  })
  const { playerRef, trim, trimmed, rangeMs } = playback
  const trimMutation = useTrimClipMutation()
  const trimChanged = !sameTrimRange(
    toPersistedTrimRange(trim, trimmed),
    initialTrim ?? null,
  )
  const canSaveTrim =
    canTrim && trimChanged && rangeMs >= MIN_TRIM_MS && !trimMutation.isPending
  // A ready clip keeps its committed server media during a background
  // re-encode. Only an unpublished clip falls back to the local capture.
  const media = useClipEditorMedia(row, mediaPending, localItem)
  const deleteFlow = useServerBackedClipDelete({
    row,
    localItem,
    prevEntry,
    nextEntry,
    handoffPoster: media.handoffPoster,
  })

  useLibraryEditorShortcuts({
    prevEntry,
    nextEntry,
    onDelete: () => {
      if (canManage) deleteFlow.openDialog()
    },
    togglePlayback: playback.togglePlayback,
  })

  // Resolves true only when the trim was persisted, so callers that leave a
  // trim UI on save (the mobile trim view) can stay put on failure.
  const handleSaveTrim = () => {
    if (!canSaveTrim) return Promise.resolve(false)
    playerRef.current?.pause()
    return trimMutation
      .mutateAsync({
        clipId: row.id,
        startMs: Math.round(trim.startMs),
        endMs: Math.round(trim.endMs),
      })
      .then(() => {
        playback.setTrim({ startMs: 0, endMs: 0 })
        playback.setCurrentMs(0)
        return true
      })
      .catch(() => false)
  }

  const tabs = {
    localItem,
    canManage,
    onRequestDelete: deleteFlow.openDialog,
    deleting: deleteFlow.pending,
    canSaveTrim,
    trimPending: trimMutation.isPending,
    trimError: trimMutation.error
      ? errorMessage(trimMutation.error, t("Couldn't trim the clip"))
      : null,
    onSaveTrim: handleSaveTrim,
  }

  return (
    <section className="flex w-full flex-col lg:h-full lg:min-h-0">
      {desktopLayout ? (
        <div className="grid w-full grid-cols-1 items-start gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1 lg:items-stretch">
          <ClipEditorStage
            row={row}
            media={media}
            playback={playback}
            processing={processing}
            canManage={canManage}
            prevEntry={prevEntry}
            nextEntry={nextEntry}
          />

          <Card
            tone="surface"
            role="complementary"
            className="min-w-0 self-stretch lg:min-h-0"
          >
            <ClipEditorTabs row={row} {...tabs} />
          </Card>
        </div>
      ) : (
        <MobileClipEditor
          row={row}
          media={media}
          playback={playback}
          processing={processing}
          canManage={canManage}
          canTrim={canTrim}
          initialTrim={initialTrim}
          prevEntry={prevEntry}
          nextEntry={nextEntry}
          tabs={tabs}
        />
      )}

      <DeleteClipDialog
        open={deleteFlow.open}
        onOpenChange={deleteFlow.setOpen}
        pending={deleteFlow.pending}
        error={deleteFlow.error}
        localItem={localItem}
        title={row.title}
        onConfirm={deleteFlow.confirm}
      />
    </section>
  )
}

function useClipEditorPermissions(row: ClipRow) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  // SAFETY: The auth API includes the optional role field on session users.
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null

  return {
    canManage:
      viewerId !== null &&
      (viewerId === row.authorId || viewerRole === "admin"),
    isOwner: viewerId !== null && viewerId === row.authorId,
  }
}

function useServerBackedClipDelete({
  row,
  localItem,
  prevEntry,
  nextEntry,
  handoffPoster,
}: {
  row: ClipRow
  localItem: Parameters<typeof DeleteClipDialog>[0]["localItem"]
  prevEntry: NavigableLibraryEntry | null
  nextEntry: NavigableLibraryEntry | null
  handoffPoster: LibraryHandoffPoster
}) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteClipMutation()
  const [open, setOpen] = useState(false)
  const [deletingLocal, setDeletingLocal] = useState(false)
  const pending = deleteMutation.isPending || deletingLocal

  const finishDelete = useCallback(
    async ({
      keptLocalItem,
    }: {
      keptLocalItem: Parameters<typeof DeleteClipDialog>[0]["localItem"]
    }) => {
      setOpen(false)
      if (keptLocalItem) {
        setLibraryHandoffPoster(keptLocalItem.id, handoffPoster)
        await navigate({
          to: "/library/$captureId",
          params: { captureId: keptLocalItem.id },
          replace: true,
        })
        removeClipDetailFromCache(queryClient, row.id)
        invalidateClipCaches(queryClient)
        return
      }

      const fallback = nextEntry ?? prevEntry
      if (fallback) {
        if (fallback.type === "cloud") {
          seedClipDetailInCache(queryClient, fallback.row)
        }
        navigateToEntry(fallback)
      } else void navigate({ to: "/library", replace: true })
    },
    [
      handoffPoster,
      navigate,
      navigateToEntry,
      nextEntry,
      prevEntry,
      queryClient,
      row.id,
    ],
  )

  const confirm = useCallback(
    (deleteLocal: boolean) => {
      const keepLocalCopy = Boolean(localItem && !deleteLocal)
      deleteMutation.mutate(
        {
          clipId: row.id,
          removeDetail: !keepLocalCopy,
          deferInvalidation: keepLocalCopy,
        },
        {
          onSuccess: async () => {
            const keptLocalItem = localItem && !deleteLocal ? localItem : null
            if (localItem) {
              await finishLocalClipDelete({
                deleteLocal,
                localItem,
                serverId: row.id,
                setDeletingLocal,
              })
            }
            await finishDelete({ keptLocalItem })
          },
        },
      )
    },
    [deleteMutation, finishDelete, localItem, row.id],
  )

  return {
    open,
    setOpen,
    openDialog: useCallback(() => setOpen(true), []),
    pending,
    error: deleteMutation.error
      ? errorMessage(deleteMutation.error, t("Couldn't delete clip"))
      : null,
    confirm,
  }
}

/**
 * Action row under the trimmer: editor hand-off and download. A pending trim
 * saves through the Details sheet's Save button, together with the fields.
 */
function DeleteClipDialog({
  open,
  onOpenChange,
  pending,
  error,
  localItem,
  title,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error: string | null
  localItem: Parameters<typeof DeleteServerBackedDialog>[0]["localItem"]
  title: string
  onConfirm: (deleteLocal: boolean) => void
}) {
  return (
    <DeleteServerBackedDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      error={error}
      title={title}
      noun="clip"
      localItem={localItem}
      onConfirm={onConfirm}
    />
  )
}
