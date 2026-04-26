import * as React from "react"
import { ImageIcon, Trash2 } from "lucide-react"

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export function MediaEditOverlay({
  radius,
  children,
}: {
  radius: "md" | "lg"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100",
        radius === "lg" ? "rounded-lg" : "rounded-md"
      )}
    >
      {children}
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
    <DropdownMenuContent anchor={anchor ?? undefined} className="w-auto">
      <MediaMenuItems kind={kind} onUpload={onUpload} onRemove={onRemove} />
    </DropdownMenuContent>
  )
}
