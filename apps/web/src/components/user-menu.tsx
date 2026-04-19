import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { LogOutIcon, ShieldIcon, UserIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/sonner"
import { UserChip } from "@workspace/ui/components/user-chip"

import { signOut, useSession } from "../lib/auth-client"
import { userChipData } from "../lib/user-display"

type SeedUser = {
  id?: string
  name?: string | null
  email?: string | null
  image?: string | null
  role?: string
} | null | undefined

/**
 * User chip + dropdown that appears in every app header. Shows Profile,
 * Admin settings (admins only), and Sign out.
 *
 * `requireAuth` on the route guarantees a session by the time this mounts,
 * but better-auth's `useSession` hook owns its own nanostore atom that
 * starts at `data: null` and fires a fresh `/get-session` on mount — so
 * without a seed the chip flashes the literal string "user" (the
 * `displayName` fallback) for the duration of that first request right
 * after sign-in. Callers pass `seedUser` (the session already fetched in
 * `beforeLoad`) so the chip renders correct info synchronously; the hook
 * still takes over once it resolves so the chip reacts to cross-tab
 * sign-out and profile edits.
 */
export function UserMenu({ seedUser }: { seedUser?: SeedUser } = {}) {
  const { data: session } = useSession()
  const user = session?.user ?? seedUser ?? undefined
  const chip = userChipData(user)
  const isAdmin = (user as { role?: string } | undefined)?.role === "admin"

  const router = useRouter()
  const navigate = useNavigate()

  async function onSignOut() {
    try {
      await signOut()
      await router.invalidate()
      await navigate({ to: "/login" })
    } catch (cause) {
      toast.error("Couldn't sign out", {
        description:
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<UserChip name={chip.name} avatar={chip.avatar} />}
      />
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem render={<Link to="/profile" />}>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem render={<Link to="/admin" />}>
            <ShieldIcon />
            Admin settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
