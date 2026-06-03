import { CopyIcon, PencilIcon, StarIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { ListItem } from "@workspace/ui/components/list"

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
  onDuplicate: () => void
  onDelete: () => void
}

export function VariantRow({
  variant,
  isDefault,
  canDelete,
  onEdit,
  onSetDefault,
  onDuplicate,
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
    <ListItem className="gap-2">
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
          aria-label={isDefault
            ? "Default playback variant"
            : "Set as default playback"}
          title={isDefault
            ? "Default playback variant"
            : "Set as default playback"}
        >
          <StarIcon
            className={isDefault ? "size-3.5 fill-current" : "size-3.5"}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDuplicate}
          aria-label="Duplicate variant"
          title="Duplicate variant"
        >
          <CopyIcon className="size-3.5" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canDelete}
                aria-label="Remove variant"
              />
            }
          >
            <Trash2Icon className="size-3.5" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove variant?</AlertDialogTitle>
              <AlertDialogDescription>
                {variant.name
                  ? `“${variant.name}” will be removed from the variant ladder.`
                  : "This variant will be removed from the variant ladder."}
                {" "}
                Existing clips keep their current renditions until re-encoded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Remove variant
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ListItem>
  )
}
