import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { Link, useBlocker } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"

import { useLibrarySearch } from "./library-entry-navigation"

export function BackToLibraryButton() {
  const search = useLibrarySearch()
  return (
    <Button variant="secondary" render={<Link to="/library" search={search} />}>
      <ArrowLeftIcon />
      {t("Back to library")}
    </Button>
  )
}

/**
 * Asks before an editor with unsaved edits is left: the prev/next arrows,
 * sidebar links and the browser's back button all go through the router, so
 * one blocker covers them. Closing or reloading the window gets the browser's
 * own prompt. Leaving on purpose (Cancel, or after a delete) passes
 * `ignoreBlocker`.
 */
export function LibraryEditorLeaveGuard({
  hasUnsavedEdits,
}: {
  hasUnsavedEdits: boolean
}) {
  const blocker = useBlocker({
    disabled: !hasUnsavedEdits,
    enableBeforeUnload: hasUnsavedEdits,
    // Search-only updates keep the editor mounted, so the edits survive them.
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname,
    withResolver: true,
  })

  return (
    <AlertDialog
      open={blocker.status === "blocked"}
      onOpenChange={(next) => {
        if (!next) blocker.reset?.()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("You have unsaved changes.")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Leave without saving? Your edits will be lost.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Keep editing")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => blocker.proceed?.()}
          >
            {t("Discard changes")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
