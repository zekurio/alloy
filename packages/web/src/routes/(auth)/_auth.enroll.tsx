import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { KeyRoundIcon } from "lucide-react"
import type { ReactNode } from "react"

import { authClient } from "@/lib/auth-client"
import { toastAuthAttemptFailure } from "@/lib/auth-flow"
import { passkeysSupported } from "@/lib/passkey-support"

/**
 * The page behind a passkey link. An admin hands the link to one user, who
 * adds a passkey to their account here and is signed in. The token is the
 * URL fragment, so it never reaches a proxy or access log.
 */
export const Route = createFileRoute("/(auth)/_auth/enroll")({
  loader: async ({ location }) => {
    const token = location.hash
    if (!token) return { token, username: null }
    const { data } = await authClient.passkey.enrollment(token)
    return { token, username: data?.username ?? null }
  },
  component: EnrollPage,
})

function EnrollPage() {
  const { token, username } = Route.useLoaderData()

  if (username === null) {
    return (
      <EnrollFrame
        title={t("This link doesn't work anymore")}
        description={t(
          "It has expired or was already used. Ask an admin for a new one.",
        )}
      >
        <Link
          to="/login"
          className={buttonVariants({
            variant: "secondary",
            size: "lg",
            className: "w-full",
          })}
        >
          {t("Sign in")}
        </Link>
      </EnrollFrame>
    )
  }
  return (
    <EnrollFrame
      title={t("Add a passkey")}
      description={t(
        "This link signs you in as {username}. Create a passkey now, and sign in with it from then on.",
        { username },
      )}
    >
      {passkeysSupported() ? (
        <EnrollButton token={token} />
      ) : (
        <p className="text-destructive text-sm" role="alert">
          {t("This browser does not support passkeys.")}
        </p>
      )}
    </EnrollFrame>
  )
}

function EnrollFrame({
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

function EnrollButton({ token }: { token: string }) {
  const navigate = useNavigate()
  const router = useRouter()
  const enroll = useMutation({
    // Resolves true once signed in and on the way home.
    mutationFn: async () => {
      const { error } = await authClient.passkey.enroll(token)
      if (error) {
        toastAuthAttemptFailure(
          "passkey link",
          message("Couldn't register passkey"),
          error,
        )
        // A used-up or expired link shows as such.
        await router.invalidate()
        return false
      }
      // Leave before reloading: this page's loader would find the link used
      // up and show it as expired.
      await navigate({ to: "/" })
      await router.invalidate()
      return true
    },
    onError: (cause) =>
      toastAuthAttemptFailure(
        "passkey link",
        message("Couldn't register passkey"),
        cause,
      ),
  })
  const pending = enroll.isPending || enroll.data === true

  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() => {
        if (!pending) enroll.mutate()
      }}
      onFocus={authClient.passkey.preload}
      onPointerEnter={authClient.passkey.preload}
    >
      <KeyRoundIcon className="size-4" />
      {pending ? t("Waiting for authenticator…") : t("Create passkey")}
    </Button>
  )
}
