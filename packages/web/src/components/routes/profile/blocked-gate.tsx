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

type BlockedGateProps = {
  open: boolean
  handle: string
  onReveal: () => void
  onCancel: () => void
}

export function BlockedGate({
  open,
  handle,
  onReveal,
  onCancel,
}: BlockedGateProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Show this profile?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "You've blocked @{handle}. Do you want to show their profile anyway?",
              { handle },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Go back")}</AlertDialogCancel>
          <AlertDialogAction onClick={onReveal}>
            {t("Show profile")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
