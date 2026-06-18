import { t as tx } from "@alloy/i18n"
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon, Trash2 } from "lucide-react"
import * as React from "react"

export type MediaKind = "avatar" | "banner"

export function MediaEditOverlay({
  tone = "shade",
  children,
}: {
  tone?: "shade" | "control"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        // Inherit the container's radius so the mask always matches the
        // avatar/banner shape — no per-call radius to keep in sync.
        "absolute inset-0 flex items-center justify-center rounded-[inherit] opacity-0 transition-opacity group-hover:opacity-100",
        tone === "shade"
          ? "bg-[oklch(12%_0.01_250)]/50"
          : "bg-[oklch(12%_0.01_250)]/50 ring-1 ring-white/20 ring-inset",
      )}
    >
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full",
          tone === "shade"
            ? "bg-transparent"
            : "bg-[oklch(12%_0.01_250)]/45 shadow-[0_2px_10px_oklch(0_0_0_/_0.24)] backdrop-blur-sm",
        )}
      >
        {children}
      </span>
    </div>
  )
}

function MediaMenuItems({
  kind,
  onUpload,
  onRemove,
}: {
  kind: MediaKind
  onUpload: () => void
  onRemove: () => void
}) {
  return (
    <>
      <DropdownMenuItem onClick={onUpload}>
        <ImageIcon />
        {tx("Upload new")}
        {kind}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={onRemove}>
        <Trash2 />
        {tx("Remove")}
        {kind}
      </DropdownMenuItem>
    </>
  )
}

export function MediaDropdownContent({
  anchor,
  kind,
  onUpload,
  onRemove,
}: {
  anchor: React.ComponentProps<typeof DropdownMenuContent>["anchor"] | null
  kind: MediaKind
  onUpload: () => void
  onRemove: () => void
}) {
  return (
    <DropdownMenuContent
      anchor={anchor ?? undefined}
      className="alloy-blur text-foreground w-auto border-white/8"
    >
      <MediaMenuItems kind={kind} onUpload={onUpload} onRemove={onRemove} />
    </DropdownMenuContent>
  )
}
