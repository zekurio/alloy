import { t as tx } from "@alloy/i18n"
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
          <AlertDialogTitle>{tx("Show this profile?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {tx("You've blocked @")}
            {handle}
            {tx(". Do you want to show their profile anyway?")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tx("Go back")}</AlertDialogCancel>
          <AlertDialogAction onClick={onReveal}>
            {tx("Show profile")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
