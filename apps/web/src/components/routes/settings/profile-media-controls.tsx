import * as React from "react"
import { ImageIcon, Trash2 } from "lucide-react"

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export function MediaEditOverlay({
  radius,
  tone = "shade",
  children,
}: {
  radius: "md" | "lg"
  tone?: "shade" | "control"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100",
        tone === "shade"
          ? "bg-[oklch(12%_0.01_250)]/50"
          : "bg-[oklch(12%_0.01_250)]/50 ring-1 ring-white/20 ring-inset",
        radius === "lg" ? "rounded-lg" : "rounded-md",
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
  kind: "avatar" | "banner"
  onUpload: () => void
  onRemove: () => void
}) {
  return (
    <>
      <DropdownMenuItem onClick={onUpload}>
        <ImageIcon />
        Upload new {kind}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={onRemove}>
        <Trash2 />
        Remove {kind}
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
  kind: "avatar" | "banner"
  onUpload: () => void
  onRemove: () => void
}) {
  return (
    <DropdownMenuContent
      anchor={anchor ?? undefined}
      className="alloy-blur w-auto border-white/8 text-foreground"
    >
      <MediaMenuItems kind={kind} onUpload={onUpload} onRemove={onRemove} />
    </DropdownMenuContent>
  )
}
