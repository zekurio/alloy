import { PencilIcon, StarIcon, Trash2Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import type { AdminEncoderVariant, EncoderCodec } from "@workspace/api"

const CODEC_LABELS: Record<EncoderCodec, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
}

type VariantRowProps = {
  variant: AdminEncoderVariant
  isDefault: boolean
  canDelete: boolean
  onEdit: () => void
  onSetDefault: () => void
  onDelete: () => void
}

export function VariantRow({
  variant,
  isDefault,
  canDelete,
  onEdit,
  onSetDefault,
  onDelete,
}: VariantRowProps) {
  const specs = [
    `${variant.height}p`,
    CODEC_LABELS[variant.codec],
    `quality ${variant.quality}`,
    variant.preset ? `preset ${variant.preset}` : null,
    `${variant.audioBitrateKbps} kbps`,
  ].filter(Boolean)

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1 rounded-md px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {variant.name || (
              <span className="text-muted-foreground italic">Unnamed</span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {specs.join("  ")}
          </div>
        </div>
      </div>

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
