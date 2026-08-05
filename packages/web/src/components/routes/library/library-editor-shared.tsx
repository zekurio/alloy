import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Dialog, DialogViewportContent } from "@alloy/ui/components/dialog"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import type { ReactNode } from "react"

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
