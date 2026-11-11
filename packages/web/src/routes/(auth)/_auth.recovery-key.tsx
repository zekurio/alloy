import type { NewRecoveryKey } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Spinner } from "@alloy/ui/components/spinner"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { ArrowRightIcon, CircleAlertIcon, RefreshCcwIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { RecoveryKeyDisplay } from "@/components/auth/recovery-key-display"
import { authClient } from "@/lib/auth-client"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"
import { errorMessage } from "@/lib/error-message"
import { searchFlag } from "@/lib/route-search"
import { useSuspenseSession } from "@/lib/session-suspense"

type RecoveryKeySearch = {
  /** Continue to the welcome dialog, as a normal sign-up does. */
  welcome?: true
}

/**
 * The step right after a passkey sign-up: make the account's first recovery
 * key and show it once. OIDC sign-ins never come here.
 */
export const Route = createFileRoute("/(auth)/_auth/recovery-key")({
  validateSearch: (search): RecoveryKeySearch =>
    searchFlag(search.welcome) ? { welcome: true } : {},
  beforeLoad: ({ context }) => {
    requireStrictAuthBeforeLoad({ context })
    if (!context.authConfig.passkeyEnabled) throw redirect({ to: "/" })
  },
  component: RecoveryKeyPage,
})

type FirstKey = { kind: "created"; key: NewRecoveryKey } | { kind: "exists" }

/**
 * The one request in flight for this page load, shared by every mount. A
 * double render, a remount or a retry joins it instead of making a second
 * key that would replace the first.
 */
let firstKey: { userId: string; promise: Promise<FirstKey> } | null = null

function makeFirstRecoveryKey(userId: string): Promise<FirstKey> {
  if (firstKey?.userId === userId) return firstKey.promise
  const promise = (async (): Promise<FirstKey> => {
    // A key that exists was already shown, maybe before a reload or a step
    // back. Replacing it here would break the one the person wrote down.
    const status = await authClient.recoveryKey.status()
    if (status.error || !status.data)
      throw status.error ?? new Error("Could not load the recovery key")
    if (status.data.createdAt !== null) return { kind: "exists" }
    const created = await authClient.recoveryKey.create()
    if (created.error || !created.data)
      throw created.error ?? new Error("Could not create a recovery key")
    return { kind: "created", key: created.data }
  })()
  const entry = { userId, promise }
  firstKey = entry
  // A failed attempt may run again.
  promise.catch(() => {
    if (firstKey === entry) firstKey = null
  })
  return promise
}

type PageState =
  | { status: "pending" }
  | { status: "done"; result: FirstKey }
  | { status: "error"; message: string }

function RecoveryKeyPage() {
  const session = useSuspenseSession()
  const { welcome } = Route.useSearch()
  const navigate = useNavigate()
  const userId = session?.user.id ?? null
  const username = session?.user.username ?? ""
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PageState>({ status: "pending" })

  useEffect(() => {
    if (!userId) return
    let live = true
    makeFirstRecoveryKey(userId).then(
      (result) => {
        if (live) setState({ status: "done", result })
      },
      (cause: unknown) => {
        if (live)
          setState({
            status: "error",
            message: errorMessage(cause, t("Could not create a recovery key")),
          })
      },
    )
    return () => {
      live = false
    }
  }, [userId, attempt])

  const proceed = () => {
    // Nothing on this page should outlive it, the key least of all.
    firstKey = null
    void navigate({
      to: "/",
      search: welcome ? { welcome: true } : {},
      replace: true,
    })
  }

  if (state.status === "pending") {
    return (
      <RecoveryKeyFrame
        title={t("Your recovery key")}
        description={t("Making your recovery key…")}
      >
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      </RecoveryKeyFrame>
    )
  }

  if (state.status === "error") {
    return (
      <RecoveryKeyFrame
        title={t("Couldn't make your recovery key")}
        description={t(
          "Try again, or continue without one. You can make one later under Settings → Profile → Recovery key.",
        )}
      >
        <div className="flex flex-col gap-3">
          <Callout tone="destructive">
            <CircleAlertIcon />
            <span>{state.message}</span>
          </Callout>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => {
              setState({ status: "pending" })
              setAttempt((count) => count + 1)
            }}
          >
            <RefreshCcwIcon />
            {t("Try again")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={proceed}
          >
            {t("Continue without a recovery key")}
          </Button>
        </div>
      </RecoveryKeyFrame>
    )
  }

  if (state.result.kind === "exists") {
    return (
      <RecoveryKeyFrame
        title={t("You already have a recovery key")}
        description={t(
          "To make a new one, go to Settings → Profile → Recovery key.",
        )}
      >
        <ContinueButton onClick={proceed} label={t("Continue")} />
      </RecoveryKeyFrame>
    )
  }

  return (
    <RecoveryKeyFrame
      title={t("Save your recovery key")}
      description={t(
        "Keep it somewhere safe, like a password manager or a printout.",
      )}
    >
      <div className="flex flex-col gap-6">
        <RecoveryKeyDisplay
          recoveryKey={state.result.key}
          username={username}
        />
        <ContinueButton onClick={proceed} label={t("I've saved it")} />
      </div>
    </RecoveryKeyFrame>
  )
}

function ContinueButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      className="w-full"
      onClick={onClick}
    >
      {label}
      <ArrowRightIcon />
    </Button>
  )
}

function RecoveryKeyFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-foreground-muted text-sm">{description}</p>
      </div>
      {children}
    </>
  )
}
