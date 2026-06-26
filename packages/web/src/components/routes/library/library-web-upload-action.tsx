import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import {
  ChevronUpIcon,
  Link2Icon,
  Loader2Icon,
  UploadIcon,
  VideoIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { ClipMetadataEditor } from "@/components/clip/clip-metadata-editor"
import {
  ACCEPT_LIST,
  captureThumbnail,
  prepareSelectedClipFile,
  stripExtension,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { absoluteClipHref } from "@/lib/app-paths"
import {
  CLIP_DESCRIPTION_MAX,
  formatTags,
  nullableClipDescription,
  normalizeClipDescription,
  normalizeClipTitle,
  parseTagString,
} from "@/lib/clip-fields"
import { copyTextToClipboard } from "@/lib/clipboard"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"

export interface LibraryWebUploadAction {
  available: boolean
  picking: boolean
  publishing: boolean
  selected: SelectedFile | null
  select: (file: File | null) => Promise<void>
  discard: () => void
  publish: (metadata: WebUploadMetadata) => Promise<void>
}

export interface WebUploadMetadata {
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
}

export function useLibraryWebUploadAction(): LibraryWebUploadAction {
  const { publishClip } = useUploadFlowControls()
  const [picking, setPicking] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const available = typeof File !== "undefined"

  const select = useCallback(
    async (file: File | null) => {
      if (!file || picking || publishing || selected) return
      setPicking(true)
      try {
        setSelected(await prepareSelectedClipFile(file))
      } catch (cause) {
        toast.error(errorMessage(cause, t("Could not prepare clip.")))
      } finally {
        setPicking(false)
      }
    },
    [picking, publishing, selected],
  )

  const discard = useCallback(() => {
    if (publishing) return
    setSelected(null)
  }, [publishing])

  const publish = useCallback(
    async (metadata: WebUploadMetadata) => {
      const current = selected
      if (!current || publishing) return

      setPublishing(true)
      try {
        const thumbnail = await captureThumbnail(
          current.file,
          Math.min(1000, Math.max(0, current.durationMs - 100)),
        )
        const result = await publishClip({
          file: current.file,
          contentType: current.contentType,
          title: normalizeClipTitle(metadata.title),
          description: nullableClipDescription(metadata.description),
          gameId: metadata.game?.id ?? null,
          privacy: metadata.privacy,
          width: current.width,
          height: current.height,
          durationMs: current.durationMs,
          sizeBytes: current.sizeBytes,
          thumbBlob: thumbnail.blob,
          thumbBlurHash: thumbnail.blurHash,
          mentionedUserIds: metadata.mentions.map((mention) => mention.id),
          tags: parseTagString(metadata.tags),
        })
        if (!result.clipId) return

        setSelected(null)
        if (metadata.privacy === "unlisted" && metadata.game) {
          const copied = await copyTextToClipboard(
            absoluteClipHref(metadata.game.slug, result.clipId, publicOrigin()),
            { action: "copy uploaded clip link" },
          )
          if (copied) {
            toast.success(t("Link copied to clipboard"))
          } else {
            toast.error(t("Couldn't copy the clip link"))
          }
          return
        }

        toast.success(t("Upload started"))
      } catch (cause) {
        toast.error(errorMessage(cause, t("Could not start upload.")))
      } finally {
        setPublishing(false)
      }
    },
    [publishClip, publishing, selected],
  )

  return { available, picking, publishing, selected, select, discard, publish }
}

export function LibraryWebUploadButton({
  action,
}: {
  action: LibraryWebUploadAction
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = action.picking || action.publishing

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_LIST}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ""
          void action.select(file)
        }}
      />
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!action.available || pending || action.selected !== null}
        title={
          action.available
            ? t("Upload clip")
            : t("Uploads are unavailable in this browser")
        }
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        {action.picking ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <UploadIcon />
        )}
        {action.picking ? t("Reading...") : t("Upload clip")}
      </Button>
    </>
  )
}

export function WebUploadClipDetailsDialog({
  action,
}: {
  action: LibraryWebUploadAction
}) {
  return (
    <WebUploadClipDetailsDialogInner
      selected={action.selected}
      pending={action.publishing}
      onOpenChange={(open) => {
        if (!open) action.discard()
      }}
      onPublish={(metadata) => {
        void action.publish(metadata)
      }}
    />
  )
}

function WebUploadClipDetailsDialogInner({
  selected,
  pending,
  onOpenChange,
  onPublish,
}: {
  selected: SelectedFile | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onPublish: (metadata: WebUploadMetadata) => void
}) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [game, setGame] = useState<GameRow | null>(null)
  const [mentions, setMentions] = useState<UserSearchResult[]>([])
  const [tags, setTags] = useState("")

  useEffect(() => {
    setTitle(selected ? stripExtension(selected.name) : "")
    setDescription("")
    setGame(null)
    setMentions([])
    setTags("")
  }, [selected?.file.lastModified, selected?.name, selected?.sizeBytes])

  const normalizedTitle = normalizeClipTitle(title)
  const normalizedDescription = normalizeClipDescription(description)
  const titleInvalid = normalizedTitle.length === 0
  const descriptionInvalid = normalizedDescription.length > CLIP_DESCRIPTION_MAX
  const canPublish =
    !pending &&
    normalizedTitle.length > 0 &&
    normalizedDescription.length <= CLIP_DESCRIPTION_MAX

  const submit = (privacy: ClipPrivacy) => {
    if (!canPublish) return
    onPublish({
      title: normalizedTitle,
      description: normalizedDescription,
      tags,
      game,
      privacy,
      mentions,
    })
  }

  return (
    <Dialog open={selected !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("Upload clip")}</DialogTitle>
          <DialogDescription>
            {t("Add clip details before the upload starts.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {selected ? <SelectedUploadSummary selected={selected} /> : null}
          <ClipMetadataEditor
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            game={game}
            onGameChange={setGame}
            mentions={mentions}
            onMentionsChange={setMentions}
            tags={parseTagString(tags)}
            onTagsChange={(next) => setTags(formatTags(next))}
            disabled={pending}
            titleInvalid={titleInvalid}
            gameInvalid={false}
          />
          {descriptionInvalid ? (
            <p className="text-destructive text-xs">
              {t("Description can be at most {max} characters", {
                max: CLIP_DESCRIPTION_MAX,
              })}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("Cancel")}
          </Button>
          <div className="flex items-center">
            <Button
              type="button"
              variant="primary"
              disabled={!canPublish}
              className="rounded-r-none"
              onClick={() => submit("public")}
            >
              {pending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <UploadIcon />
              )}
              {pending ? t("Uploading...") : t("Post")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="primary"
                    size="icon"
                    disabled={!canPublish}
                    aria-label={t("More upload options")}
                    className="border-l-accent-hover size-9 rounded-l-none sm:size-8"
                  />
                }
              >
                <ChevronUpIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                <DropdownMenuItem onClick={() => submit("unlisted")}>
                  <Link2Icon className="size-4" />
                  {t("Create Link")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SelectedUploadSummary({ selected }: { selected: SelectedFile }) {
  return (
    <div className="border-border bg-surface-raised/60 flex min-w-0 items-center gap-3 rounded-md border p-3">
      <div className="bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-md">
        <VideoIcon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-semibold">
          {selected.name}
        </p>
        <p className="text-foreground-muted truncate text-xs">
          {[selected.size, selected.duration, selected.resolution].join(" - ")}
        </p>
      </div>
    </div>
  )
}
