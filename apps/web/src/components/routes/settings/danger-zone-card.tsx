import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { EyeOffIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"

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
import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { authClient, signOut } from "@/lib/auth-client"
import { clientLogger } from "@/lib/client-log"
import { errorMessage } from "@/lib/error-message"
import { resetClientState } from "@/lib/query-client"

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

function useAccountDisabledState() {
  const [disabledAt, setDisabledAt] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const mountedRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const state = await api.users.fetchAccountState()
      if (!mountedRef.current) return
      setDisabledAt(state.disabledAt)
    } catch (cause) {
      if (!mountedRef.current) return
      setError(errorMessage(cause, "Couldn't load account status"))
      clientLogger.warn("[account] Failed to load account status.", cause)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const setKnownDisabledAt = React.useCallback((next: string | null) => {
    setError(null)
    setDisabledAt(next)
  }, [])

  return {
    disabledAt,
    error,
    loading,
    reload: load,
    setDisabledAt: setKnownDisabledAt,
  }
}

function useAccountDangerActions() {
  const router = useRouter()
  const navigate = useNavigate()
  const [pendingAction, setPendingAction] = React.useState<
    "disable" | "reactivate" | "delete" | null
  >(null)
  const { disabledAt, error, loading, reload, setDisabledAt } =
    useAccountDisabledState()

  const pending = pendingAction !== null

  async function onDisable() {
    if (pending) return
    setPendingAction("disable")
    try {
      const state = await api.users.disableAccount()
      setDisabledAt(state.disabledAt)
      toast.success("Account disabled")
      try {
        await signOut()
      } catch (cause) {
        clientLogger.warn("[account] Failed to sign out after disable.", cause)
      }
      resetClientState()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't disable account"))
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
      toast.error(errorMessage(cause, "Couldn't reactivate account"))
    } finally {
      setPendingAction(null)
    }
  }

  async function onDelete() {
    if (pending) return
    setPendingAction("delete")
    try {
      const { error } = await authClient.deleteUser()
      if (error) {
        toast.error(errorMessage(error, "Couldn't delete account"))
        return
      }
      toast.success("Account deleted")
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error(errorMessage(cause, "Something went wrong"))
    } finally {
      setPendingAction(null)
    }
  }

  return {
    disabledAt,
    accountStateError: error,
    accountStateLoading: loading,
    reloadAccountState: reload,
    pending,
    pendingAction,
    onDisable,
    onReactivate,
    onDelete,
  }
}

function DisableAccountRow({
  disabledAt,
  accountStateError,
  accountStateLoading,
  reloadAccountState,
  pending,
  pendingAction,
  onDisable,
  onReactivate,
}: {
  disabledAt: string | null
  accountStateError: string | null
  accountStateLoading: boolean
  reloadAccountState: () => Promise<void>
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  onDisable: () => Promise<void>
  onReactivate: () => Promise<void>
}) {
  if (accountStateError) {
    return (
      <AccountActionRow title="Account status" description={accountStateError}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reloadAccountState}
          disabled={pending || accountStateLoading}
        >
          <RotateCcwIcon />
          {accountStateLoading ? "Loading..." : "Retry"}
        </Button>
      </AccountActionRow>
    )
  }

  if (accountStateLoading) {
    return (
      <AccountActionRow
        title="Account status"
        description="Loading current account status."
      >
        <Button type="button" variant="outline" size="sm" disabled>
          <RotateCcwIcon />
          Loading...
        </Button>
      </AccountActionRow>
    )
  }

  return (
    <AccountActionRow
      title={disabledAt ? "Reactivate account" : "Disable account"}
      description={disabledAt
        ? "Make your profile and clips visible again."
        : "Hide your profile and clips until you reactivate your account."}
    >
      {disabledAt
        ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReactivate}
            disabled={pending}
          >
            <RotateCcwIcon />
            {pendingAction === "reactivate" ? "Reactivating..." : "Reactivate"}
          </Button>
        )
        : (
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
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDisable} disabled={pending}>
                  {pendingAction === "disable"
                    ? "Disabling..."
                    : "Disable account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
    </AccountActionRow>
  )
}

function DeleteAccountRow({
  pending,
  pendingAction,
  onDelete,
}: {
  pending: boolean
  pendingAction: "disable" | "reactivate" | "delete" | null
  onDelete: () => Promise<void>
}) {
  return (
    <AccountActionRow
      title="Delete account"
      description="Permanently removes your account and clips. Can't be undone."
    >
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="danger" size="sm">
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
              {pendingAction === "delete" ? "Deleting..." : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccountActionRow>
  )
}

export function DangerZoneCard() {
  const actions = useAccountDangerActions()

  return (
    <Section>
      <SectionContent className="divide-y divide-border py-0">
        <DisableAccountRow {...actions} />
        <DeleteAccountRow {...actions} />
      </SectionContent>
    </Section>
  )
}
