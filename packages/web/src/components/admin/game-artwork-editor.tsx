import type { GameAssetRole } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useId, useRef, useState } from "react"
import type { ReactNode } from "react"

import { ImageCropDialog } from "@/components/media/image-crop-dialog"
import type { CropMode } from "@/components/media/image-crop-utils"

import { GAME_ASSET_FIELDS, GAME_ASSET_ROLES } from "./admin-game-data"

/**
 * Crop frames matching the sizes the server renders each role to. The logo is
 * missing on purpose: it is a transparent wordmark of any aspect, which the
 * server fits rather than crops, so it uploads untouched.
 */
const ROLE_CROP_MODE = {
  hero: "gameHero",
  grid: "gameGrid",
  icon: "gameIcon",
  logo: null,
} satisfies Record<GameAssetRole, CropMode | null>

/**
 * The four artwork slots as one row of tiles, with the selected slot's actions
 * and sources underneath. Nothing here writes to the server: picks are handed
 * to the parent, which stages them until the dialog is saved.
 */
export function GameArtworkEditor({
  role,
  onRoleChange,
  src,
  changed,
  disabled = false,
  onFile,
  onRemove,
  children,
}: {
  /** The selected slot, owned by the parent so its sources can follow it. */
  role: GameAssetRole
  onRoleChange: (role: GameAssetRole) => void
  /** The image a slot would show once saved, staged changes included. */
  src: (role: GameAssetRole) => string | null
  /** Whether a slot differs from what is saved. */
  changed: (role: GameAssetRole) => boolean
  disabled?: boolean
  onFile: (role: GameAssetRole, file: File) => void
  onRemove: (role: GameAssetRole) => void
  /** More ways to fill the selected slot, e.g. the SteamGridDB options. */
  children?: ReactNode
}) {
  const [cropping, setCropping] = useState<{
    role: GameAssetRole
    file: File
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The one file input serves every slot; this is the slot it was opened for.
  const uploadRoleRef = useRef<GameAssetRole>("grid")
  const headingId = useId()

  const openFilePicker = (target: GameAssetRole) => {
    uploadRoleRef.current = target
    inputRef.current?.click()
  }

  const selected = src(role)

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
    >
      <span id={headingId} className="text-sm leading-4 font-medium">
        {t("Artwork")}
      </span>
      <div className="grid grid-cols-4 gap-2">
        {GAME_ASSET_ROLES.map((item) => (
          <ArtworkTile
            key={item}
            label={GAME_ASSET_FIELDS[item].label}
            src={src(item)}
            changed={changed(item)}
            selected={item === role}
            disabled={disabled}
            onSelect={() => {
              onRoleChange(item)
              // With nothing to browse, an empty slot has one possible next
              // step, so selecting it goes straight to the file picker.
              if (!children && !src(item)) openFilePicker(item)
            }}
          />
        ))}
      </div>

      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="text-foreground-muted min-w-0 text-xs">
          {GAME_ASSET_FIELDS[role].description}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {selected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onRemove(role)}
            >
              <Trash2Icon />
              {t("Remove")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => openFilePicker(role)}
          >
            <UploadIcon />
            {selected ? t("Replace") : t("Upload")}
          </Button>
        </div>
      </div>

      {children}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          const target = uploadRoleRef.current
          if (ROLE_CROP_MODE[target]) setCropping({ role: target, file })
          else onFile(target, file)
        }}
      />
      <ImageCropDialog
        file={cropping?.file ?? null}
        // Only roles with a crop mode ever open the dialog; the fallback keeps
        // it mounted (and animating out) once the pending crop clears.
        mode={(cropping && ROLE_CROP_MODE[cropping.role]) ?? "gameGrid"}
        open={cropping !== null}
        applying={false}
        onOpenChange={(open) => {
          if (!open) setCropping(null)
        }}
        onApply={async ({ blob }) => {
          if (!cropping) return
          onFile(
            cropping.role,
            new File([blob], cropping.file.name, { type: blob.type }),
          )
          setCropping(null)
        }}
      />
    </div>
  )
}

function ArtworkTile({
  label,
  src,
  changed,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  src: string | null
  changed: boolean
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-60",
        selected
          ? "border-accent-border bg-surface-raised text-foreground"
          : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "bg-surface-sunken flex h-14 items-center justify-center overflow-hidden rounded-md sm:h-16",
          // An empty slot reads as an outline waiting to be filled.
          src ? null : "border-border-strong border border-dashed",
        )}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className="block max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageIcon className="text-foreground-faint size-4" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-xs leading-4 font-semibold">
        <span className="truncate">{label}</span>
        {changed ? (
          <span
            title={t("Unsaved")}
            className="bg-accent size-1.5 shrink-0 rounded-full"
          >
            <span className="sr-only">{t("Unsaved")}</span>
          </span>
        ) : null}
      </span>
    </button>
  )
}
