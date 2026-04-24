import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  DownloadIcon,
  EyeOffIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"

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

import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { getQueryClient } from "@/lib/query-client"

function AccountActionRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function DangerZoneCard() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pendingAction, setPendingAction] = React.useState<
    "disable" | "reactivate" | "clips" | "delete" | null
  >(null)
  const [disabledAt, setDisabledAt] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    api.users
      .fetchAccountState()
      .then((state) => {
        if (active) setDisabledAt(state.disabledAt)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const pending = pendingAction !== null

  async function onDisable() {
    if (pending) return
    setPendingAction("disable")
    try {
      const state = await api.users.disableAccount()
      setDisabledAt(state.disabledAt)
      toast.success("Account disabled")
      await router.invalidate()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't disable account"
      )
    } finally {
      setPendingAction(null)
    }
  }

  async function onReactivate() {
    if (pending) return
    setPendingAction("reactivate")
    try {
      await api.users.reactivateAccount()
      setDisabledAt(null)
      toast.success("Account reactivated")
      await router.invalidate()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't reactivate account"
      )
    } finally {
      setPendingAction(null)
    }
  }

  async function onDeleteAllClips() {
    if (pending) return
    setPendingAction("clips")
    try {
      const result = await api.users.deleteAllClips()
      await getQueryClient().invalidateQueries()
      toast.success(
        result.deleted === 1
          ? "Deleted 1 clip"
          : `Deleted ${result.deleted} clips`
      )
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't delete clips"
      )
    } finally {
      setPendingAction(null)
    }
  }

  function onDownloadAllClips() {
    window.location.assign(api.users.downloadAllClipsUrl())
  }

  async function onDelete() {
    if (pending) return
    setPendingAction("delete")
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
      setPendingAction(null)
    }
  }

  return (
    <Section>
      <SectionContent className="divide-y divide-border py-0">
        <AccountActionRow
          title="Download clips"
          description="Download a zip archive with the original files for your clips."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDownloadAllClips}
          >
            <DownloadIcon />
            Download
          </Button>
        </AccountActionRow>

        <AccountActionRow
          title="Delete clips"
          description="Permanently removes every clip you uploaded. This can't be undone."
        >
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="destructive" size="sm">
                  <Trash2Icon />
                  Delete clips
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all clips?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes every clip you uploaded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={onDeleteAllClips}
                  disabled={pending}
                >
                  {pendingAction === "clips" ? "Deleting…" : "Delete clips"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </AccountActionRow>

        <AccountActionRow
          title={disabledAt ? "Reactivate account" : "Disable account"}
          description={
            disabledAt
              ? "Make your profile and clips visible again."
              : "Hide your profile and clips until you reactivate your account."
          }
        >
          {disabledAt ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReactivate}
              disabled={pending}
            >
              <RotateCcwIcon />
              {pendingAction === "reactivate" ? "Reactivating…" : "Reactivate"}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button type="button" variant="outline" size="sm">
                    <EyeOffIcon />
                    Disable
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disable your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your profile and clips will be hidden until you sign back in
                    and reactivate.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={onDisable} disabled={pending}>
                    {pendingAction === "disable"
                      ? "Disabling…"
                      : "Disable account"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </AccountActionRow>

        <AccountActionRow
          title="Delete account"
          description="Permanently removes your account and clips. Can't be undone."
        >
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
                  {pendingAction === "delete" ? "Deleting…" : "Delete account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </AccountActionRow>
      </SectionContent>
    </Section>
  )
}
