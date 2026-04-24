import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Section, SectionContent } from "@workspace/ui/components/section"
import { toast } from "@workspace/ui/components/sonner"

import { authClient } from "@/lib/auth-client"

export function DangerZoneCard() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = React.useState(false)

  async function onDelete() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.deleteUser()
      if (error) {
        toast.error(error.message ?? "Couldn't delete account")
        return
      }
      toast.success("Account deleted")
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Section>
      <SectionContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Delete account</div>
          <p className="mt-0.5 text-xs text-foreground-dim">
            Permanently removes your account and clips. Can't be undone.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="destructive" size="sm">
                <Trash2Icon />
                Delete account
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={onDelete}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SectionContent>
    </Section>
  )
}
