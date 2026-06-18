import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { useNavigate } from "@tanstack/react-router"
import { ClapperboardIcon, PlusIcon, UploadIcon } from "lucide-react"

import { useCreateActions } from "./create-actions"

type CreateMenuProps = {
  placement?: "inline" | "floating"
}

/** Global rounded `+` button — the create entry point shown on every page. */
export function CreateMenu({ placement = "inline" }: CreateMenuProps) {
  const navigate = useNavigate()
  const {
    projectDisabled,
    uploadLabel,
    uploadBusy,
    uploadDisabled,
    startUpload,
  } = useCreateActions()
  const floating = placement === "floating"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="primary"
            size="icon"
            className={
              floating
                ? "size-14 rounded-full shadow-[0_14px_40px_-18px_var(--accent-glow),0_14px_32px_-16px_rgb(0_0_0_/_0.75)] ring-1 ring-white/12 [&_svg]:size-6"
                : "rounded-full"
            }
            aria-label={tx("Create")}
          />
        }
      >
        <PlusIcon className={floating ? "size-8" : undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={floating ? "top" : "bottom"}
        sideOffset={floating ? 10 : 4}
        className="w-48"
      >
        <DropdownMenuItem
          disabled={projectDisabled}
          onClick={() => {
            void navigate({ to: "/editor" })
          }}
        >
          <ClapperboardIcon />
          {tx("New project")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={uploadBusy || uploadDisabled}
          onClick={startUpload}
        >
          <UploadIcon />
          {uploadBusy ? tx("Staging...") : uploadLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
