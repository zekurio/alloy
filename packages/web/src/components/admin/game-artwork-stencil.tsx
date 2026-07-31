import type { GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import type { ReactNode } from "react"

import { ImageCropDialog } from "@/components/media/image-crop-dialog"
import type { CropMode } from "@/components/media/image-crop-utils"
import { MediaEditOverlay } from "@/components/routes/settings/profile-media-controls"
import { useClickAnchor } from "@/hooks/use-click-anchor"

import { GAME_ASSET_FIELDS } from "./admin-game-data"

export type GameArtworkSlot = {
  src: string | null
  busy?: boolean
  /**
   * Resolving `false` signals the upload failed, so the crop dialog stays open
   * for a retry; `void`/`true` means the file was accepted.
   */
  onSelect: (file: File) => void | boolean | Promise<void | boolean>
  onRemove: () => void
}

/**
 * Crop frames matching the sizes the server renders each role to. The logo is
 * missing on purpose: it is a transparent wordmark of any aspect, which the
 * server fits rather than crops, so it uploads untouched.
 */
const ROLE_CROP_MODE: Partial<Record<GameAssetRole, CropMode>> = {
  hero: "gameHero",
  grid: "gameGrid",
  icon: "gameIcon",
}

/**
 * The artwork picker drawn as a miniature of the real game page: the hero
 * banner with the logo where the page title sits, above the list row where the
 * cover and icon show up. Every zone is a slot, so the shape of the stencil —
 * not a caption — says which image belongs where.
 */
export function GameArtworkStencil({
  name,
  releaseDate,
  slot,
}: {
  name: string
  releaseDate: string
  slot: (role: GameAssetRole) => GameArtworkSlot
}) {
  const title = name.trim() || t("Untitled game")
  // Date inputs hand back `YYYY-MM-DD`; the header only ever shows the year.
  const year = /^\d{4}/.exec(releaseDate)?.[0] ?? null
  const [cropping, setCropping] = useState<{
    role: GameAssetRole
    file: File
  } | null>(null)

  const chooseFile = (role: GameAssetRole, file: File) => {
    if (ROLE_CROP_MODE[role]) {
      setCropping({ role, file })
      return
    }
    void slot(role).onSelect(file)
  }

  const croppingBusy = cropping ? !!slot(cropping.role).busy : false

  return (
    <div className="bg-surface-sunken ring-border/60 overflow-hidden rounded-xl ring-1">
      {/* Page header — banner behind, logo standing in for the title. */}
      <div className="relative aspect-[4/1] max-h-52 min-h-[128px] w-full">
        {/* The banner spans the whole header, so the card's own frame stands in
            for the dashed outline the smaller slots carry. */}
        <ArtworkZone
          assetRole="hero"
          slot={slot("hero")}
          onFile={chooseFile}
          className="absolute inset-0 rounded-none border-0"
        >
          <ImageIcon className="size-5" aria-hidden />
          <span className="text-xs font-semibold">
            {GAME_ASSET_FIELDS.hero.label}
          </span>
          <span className="text-2xs">{GAME_ASSET_FIELDS.hero.description}</span>
        </ArtworkZone>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/45 to-transparent"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
          <ArtworkZone
            assetRole="logo"
            slot={slot("logo")}
            onFile={chooseFile}
            className="pointer-events-auto max-w-[70%] min-w-0 rounded-md px-2 py-1"
            imageClassName="h-9 w-auto max-w-full object-contain sm:h-11"
          >
            <span className="truncate text-lg font-semibold tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)]">
              {title}
            </span>
          </ArtworkZone>
          {year ? (
            <span className="shrink-0 pb-1.5 text-xs font-medium text-white/70">
              {t("Released")} {year}
            </span>
          ) : null}
        </div>
      </div>

      {/* List row — where the cover and the icon badge turn up. */}
      <div className="border-border/60 flex items-center gap-3 border-t p-3">
        <ArtworkZone
          assetRole="grid"
          slot={slot("grid")}
          onFile={chooseFile}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
        >
          <ImageIcon className="size-4" aria-hidden />
          <span className="text-2xs font-semibold">
            {GAME_ASSET_FIELDS.grid.label}
          </span>
        </ArtworkZone>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <ArtworkZone
              assetRole="icon"
              slot={slot("icon")}
              onFile={chooseFile}
              className="size-9 shrink-0 rounded-md"
              imageClassName="size-full object-contain"
            >
              <ImageIcon className="size-4" aria-hidden />
            </ArtworkZone>
            <span className="text-foreground truncate text-sm font-semibold">
              {title}
            </span>
          </div>
          <span className="text-foreground-faint text-xs">
            {t("Cover and icon stand in for the game in lists and search.")}
          </span>
        </div>
      </div>

      <ImageCropDialog
        file={cropping?.file ?? null}
        // Only roles with a crop mode ever open the dialog; the fallback keeps
        // it mounted (and animating out) once the pending crop clears.
        mode={(cropping && ROLE_CROP_MODE[cropping.role]) ?? "gameGrid"}
        open={cropping !== null}
        applying={croppingBusy}
        onOpenChange={(open) => {
          if (!open && !croppingBusy) setCropping(null)
        }}
        onApply={async ({ blob }) => {
          if (!cropping) return
          const accepted = await slot(cropping.role).onSelect(
            new File([blob], cropping.file.name, { type: blob.type }),
          )
          // A failed upload keeps the dialog open so the framing isn't lost.
          if (accepted !== false) setCropping(null)
        }}
      />
    </div>
  )
}

/**
 * One slot of the stencil. Empty zones open the file picker straight away;
 * filled ones open the replace/remove menu, matching the profile media zones.
 * `children` is the empty-state hint, shown until the zone has an image.
 */
function ArtworkZone({
  assetRole,
  slot,
  onFile,
  className,
  imageClassName,
  children,
}: {
  assetRole: GameAssetRole
  slot: GameArtworkSlot
  onFile: (role: GameAssetRole, file: File) => void
  className?: string
  imageClassName?: string
  children: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const anchor = useClickAnchor()
  const label = GAME_ASSET_FIELDS[assetRole].label

  const surface = cn(
    "group relative flex items-center justify-center overflow-hidden",
    "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-70",
    // Empty slots read as a stencil outline; a filled one shows only its art.
    slot.src
      ? null
      : "border-border-strong bg-surface-raised/40 border border-dashed",
    className,
  )

  const zone = (
    <>
      {slot.src ? (
        <img
          src={slot.src}
          alt=""
          className={cn("block size-full object-cover", imageClassName)}
        />
      ) : (
        // Fades out on hover so it doesn't collide with the pencil affordance.
        <span className="text-foreground-faint pointer-events-none flex min-w-0 flex-col items-center gap-0.5 px-1 text-center transition-opacity group-hover:opacity-0">
          {children}
        </span>
      )}
      {slot.busy ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-[oklch(12%_0.01_250)]/50">
          <Spinner className="size-4" />
        </span>
      ) : (
        <MediaEditOverlay>
          <PencilIcon className="size-4 text-white" />
        </MediaEditOverlay>
      )}
    </>
  )

  return (
    <>
      {slot.src ? (
        <DropdownMenu open={anchor.open} onOpenChange={anchor.onOpenChange}>
          <DropdownMenuTrigger
            disabled={slot.busy}
            title={label}
            aria-label={t("Change {label}", { label })}
            className={surface}
            onPointerDown={anchor.onTriggerPointerDown}
          >
            {zone}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            anchor={anchor.anchor}
            className="alloy-blur text-foreground w-max min-w-44 border-white/8"
          >
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <UploadIcon />
              <span>{t("Replace {label}", { label })}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={slot.onRemove}>
              <Trash2Icon />
              <span>{t("Remove {label}", { label })}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type="button"
          disabled={slot.busy}
          title={label}
          aria-label={t("Add {label}", { label })}
          className={surface}
          onClick={() => inputRef.current?.click()}
        >
          {zone}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) onFile(assetRole, file)
        }}
      />
    </>
  )
}
