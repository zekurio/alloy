import { cn } from "@workspace/ui/lib/utils"

type AuthUser = {
  id?: string
  name?: string | null
  username?: string | null
  displayUsername?: string | null
  email?: string | null
  image?: string | null
}

/**
 * Pulls a stable display name. Prefers the free-form `name` (what the user
 * actually wants to be called), then the handle, then the email local part.
 */
export function displayName(user: AuthUser | null | undefined): string {
  if (!user) return "user"
  if (user.name && user.name.trim()) return user.name.trim()
  if (user.displayUsername && user.displayUsername.trim()) {
    return user.displayUsername.trim()
  }
  if (user.username && user.username.trim()) return user.username.trim()
  if (user.email) return user.email.split("@")[0] ?? "user"
  return "user"
}

/** Up to two uppercase letters from the display name. */
export function displayInitials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

/** Avatar tint derived from user id (or name as fallback) so each user is visually distinct. */
export function avatarTint(seed: string): { bg: string; fg: string } {
  const hue = hashString(seed || "user") % 360
  return {
    bg: `oklch(0.32 0.18 ${hue})`,
    fg: `oklch(0.92 0.1 ${hue})`,
  }
}

export type UserAvatar = {
  src?: string
  initials: string
  bg: string
  fg: string
}

/**
 * Everything needed to render an avatar for a user. `src` may be undefined
 * (show `initials` in an `AvatarFallback` with the `bg`/`fg` tint).
 */
export function userAvatar(user: AuthUser | null | undefined): UserAvatar {
  const name = displayName(user)
  const { bg, fg } = avatarTint(user?.id ?? name)
  return {
    src: user?.image ?? undefined,
    initials: displayInitials(name),
    bg,
    fg,
  }
}

export type UserChipData = {
  name: string
  avatar: UserAvatar
}

export function userChipData(user: AuthUser | null | undefined): UserChipData {
  return { name: displayName(user), avatar: userAvatar(user) }
}

export function useUserChipData(
  user: AuthUser | null | undefined
): UserChipData {
  return userChipData(user)
}

export function UserBanner({
  user,
  className,
}: {
  user: AuthUser | null | undefined
  className?: string
}) {
  const name = displayName(user)
  const { bg } = avatarTint(user?.id ?? name)
  const image = user?.image ?? null
  return (
    <div
      aria-hidden
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{ backgroundColor: bg }}
    >
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden
          decoding="async"
          className="absolute inset-0 size-full scale-150 object-cover blur-3xl brightness-75 saturate-150"
        />
      ) : null}
    </div>
  )
}
