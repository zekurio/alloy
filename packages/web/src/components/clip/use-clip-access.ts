import { isAdmin } from "@/lib/auth-access"
import { useSession } from "@/lib/auth-client"

/** Owners and admins manage a clip; the server re-checks every action. */
export function useClipAccess(authorId: string) {
  const { data: session } = useSession()
  const admin = isAdmin(session ?? null)
  return { isAdmin: admin, canManage: session?.user.id === authorId || admin }
}
