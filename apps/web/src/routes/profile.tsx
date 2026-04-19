import * as React from "react"
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { ArrowLeftIcon, Trash2Icon } from "lucide-react"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
} from "@workspace/ui/components/app-header"
import { AppMain, AppShell } from "@workspace/ui/components/app-shell"
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import { UserMenu } from "../components/user-menu"
import { authClient, useSession } from "../lib/auth-client"
import { requireAuth } from "../lib/route-guards"
import {
  avatarTint,
  displayInitials,
  displayName,
} from "../lib/user-display"

/**
 * Self-service profile page. Users who were bootstrapped via the
 * credential sign-up (the first admin, typically) don't get their `image`
 * or `name` refreshed when they later link an OAuth identity, so this
 * gives them a place to set those by hand. Also exposes account deletion.
 */
export const Route = createFileRoute("/profile")({
  // See the note in `/` — we expose the requireAuth result so `UserMenu`
  // can render the correct identity on first paint instead of flashing
  // the "user" fallback while `useSession` fetches.
  beforeLoad: async () => ({ session: await requireAuth() }),
  component: ProfilePage,
})

function ProfilePage() {
  const { session: seedSession } = Route.useRouteContext()
  const { data: session } = useSession()
  const user = session?.user ?? seedSession?.user

  return (
    <AppShell>
      <AppHeader>
        <AppHeaderBrand />
        <AppHeaderActions>
          <UserMenu seedUser={seedSession?.user} />
        </AppHeaderActions>
      </AppHeader>
      <AppMain>
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link
              to="/"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" /> Back
            </Link>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Profile
            </h1>
          </div>

          {user ? (
            <>
              <ProfileCard
                key={user.id}
                userId={user.id}
                initialName={user.name ?? ""}
                image={user.image ?? ""}
                email={user.email ?? ""}
              />
              <DangerZoneCard />
            </>
          ) : null}
        </div>
      </AppMain>
    </AppShell>
  )
}

function ProfileCard({
  userId,
  initialName,
  image,
  email,
}: {
  userId: string
  initialName: string
  image: string
  email: string
}) {
  const router = useRouter()
  const [name, setName] = React.useState(initialName)
  const [pending, setPending] = React.useState(false)

  const trimmedName = name.trim()
  const dirty = trimmedName !== initialName.trim()

  const preview = {
    name: displayName({
      id: userId,
      name: trimmedName || null,
      email,
      image: image || null,
    }),
    image: image || undefined,
  }
  const initials = displayInitials(preview.name)
  const { bg, fg } = avatarTint(userId || preview.name)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || !dirty) return
    setPending(true)
    try {
      const { error } = await authClient.updateUser({
        name: trimmedName,
      })
      if (error) {
        toast.error(error.message ?? "Couldn't save")
        return
      }
      toast.success("Saved")
      // Refresh the session so `useSession()` consumers (header chip,
      // user menu) see the new name + image immediately.
      await router.invalidate()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Something went wrong",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Avatar size="xl" style={{ background: bg, color: fg }}>
              {preview.image ? (
                <AvatarImage src={preview.image} alt={preview.name} />
              ) : null}
              <AvatarFallback style={{ background: bg, color: fg }}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {preview.name}
              </span>
              <span className="font-mono text-2xs text-foreground-faint">
                {email}
              </span>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
            <Input
              id="profile-name"
              type="text"
              autoComplete="name"
              value={name}
              required
              maxLength={128}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </Field>
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || !dirty}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function DangerZoneCard() {
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
        cause instanceof Error ? cause.message : "Something went wrong",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>This can't be undone.</CardDescription>
        </div>
      </CardHeader>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="destructive" size="sm">
                <Trash2Icon className="size-4" />
                Delete my account
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
      </CardFooter>
    </Card>
  )
}
