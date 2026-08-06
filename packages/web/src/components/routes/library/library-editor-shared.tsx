import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Dialog, DialogViewportContent } from "@alloy/ui/components/dialog"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import type { ReactNode } from "react"

import { UploadCenter } from "@/components/upload/upload-center"

export function LibraryEditorDialog({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return
        void navigate({ to: "/library", replace: true })
      }}
      disablePointerDismissal
    >
      <DialogViewportContent className="flex flex-col p-0 [&>[data-slot=app-main]]:min-h-0 [&>[data-slot=app-main]]:flex-1 max-md:[&>[data-slot=app-main]]:pb-4">
        {children}
        <div className="absolute right-4 bottom-4 z-10 hidden md:flex">
          <UploadCenter variant="floating" />
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 flex h-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))] items-center justify-center pb-[env(safe-area-inset-bottom)] md:hidden">
          <UploadCenter variant="bottom-nav" />
        </div>
      </DialogViewportContent>
    </Dialog>
  )
}

export function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      {t("Back to library")}
    </Button>
  )
}
