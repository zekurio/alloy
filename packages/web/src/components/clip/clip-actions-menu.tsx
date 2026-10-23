import { t } from "@alloy/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { PencilIcon, Trash2Icon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

/**
 * Overflow menu for the clip viewer: download for anyone who can access the
 * clip, then edit, admin actions and delete for owners and admins. Renders
 * nothing when the viewer has none of these.
 */
export function ClipActionsMenu({
  trigger,
  canManage,
  deleting,
  downloadAction,
  adminActions,
  onEdit,
  onDelete,
}: {
  trigger: ReactElement
  canManage: boolean
  deleting: boolean
  downloadAction?: ReactNode
  /** Extra items between Edit and Delete; callers gate them on admin. */
  adminActions?: ReactNode
  onEdit: () => void
  onDelete: () => void
}) {
  if (!canManage && !downloadAction) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="end"
        className="alloy-blur w-max max-w-[calc(100dvw-2rem)] min-w-56"
      >
        {downloadAction}
        {canManage && downloadAction ? <DropdownMenuSeparator /> : null}
        {canManage ? (
          <>
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon /> {t("Edit")}
            </DropdownMenuItem>
            {adminActions}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting}
              onClick={onDelete}
            >
              <Trash2Icon /> {t("Delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
