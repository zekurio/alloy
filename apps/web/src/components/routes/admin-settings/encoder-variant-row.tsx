import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import type { AdminEncoderVariant } from "@workspace/api"

type VariantRowProps = {
  variant: AdminEncoderVariant
  isDefault: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
  onEdit: () => void
  onSetDefault: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

export function VariantRow({
  variant,
  isDefault,
  canMoveUp,
  canMoveDown,
  canDelete,
  onEdit,
  onSetDefault,
  onMoveUp,
  onMoveDown,
  onDelete,
}: VariantRowProps) {
  const specs = [
    `${variant.height}p`,
    variant.encoder || "ffmpeg default encoder",
    variant.hwaccel ? `hwaccel ${variant.hwaccel}` : "no hwaccel",
    `quality ${variant.quality}`,
    `${variant.audioBitrateKbps} kbps`,
  ]

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
        onClick={onEdit}
      >
        <StarIcon
          className={
            isDefault
              ? "size-3.5 shrink-0 fill-current text-foreground"
              : "size-3.5 shrink-0 text-muted-foreground/40"
          }
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {variant.name || (
              <span className="text-muted-foreground italic">Unnamed</span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {specs.join(" · ")}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label="Edit variant"
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onSetDefault}
          disabled={isDefault}
          aria-label={
            isDefault ? "Default playback variant" : "Set as default playback"
          }
          title={
            isDefault ? "Default playback variant" : "Set as default playback"
          }
        >
          <StarIcon
            className={isDefault ? "size-3.5 fill-current" : "size-3.5"}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="Move up"
        >
          <ChevronUpIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move down"
        >
          <ChevronDownIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={!canDelete}
          aria-label="Remove variant"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
