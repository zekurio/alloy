import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { CloudUploadIcon, PlusIcon } from "lucide-react"

import { useCreateActions } from "./create-actions"

type CreateMenuProps = {
  placement?: "inline" | "floating" | "sidebar"
}

/** Global rounded `+` button - the upload/import entry point shown on every page. */
export function CreateMenu({ placement = "inline" }: CreateMenuProps) {
  const { uploadLabel, uploadDisabled, startUpload } = useCreateActions()
  const floating = placement === "floating"
  const sidebar = placement === "sidebar"

  if (sidebar) {
    return (
      <Button
        type="button"
        variant="primary"
        size="default"
        data-upload-trigger=""
        disabled={uploadDisabled}
        className="h-9 w-full justify-start rounded-md px-3 [&_svg]:size-5"
        aria-label={uploadLabel || tx("Upload")}
        title={uploadLabel || tx("Upload")}
        onClick={startUpload}
      >
        <CloudUploadIcon />
        <span className="truncate">{uploadLabel || tx("Upload")}</span>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      data-upload-trigger=""
      variant="primary"
      size="icon"
      disabled={uploadDisabled}
      className={
        floating
          ? "size-14 rounded-full shadow-[0_14px_40px_-18px_var(--accent-glow),0_14px_32px_-16px_rgb(0_0_0_/_0.75)] ring-1 ring-white/12 [&_svg]:size-6"
          : "rounded-full"
      }
      aria-label={uploadLabel || tx("Upload")}
      title={uploadLabel || tx("Upload")}
      onClick={startUpload}
    >
      <PlusIcon className={floating ? "size-8" : undefined} />
    </Button>
  )
}
