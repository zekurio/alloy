/**
 * Helpers that turn a better-auth user into the display shape our UI chrome
 * expects (name, avatar tint). Kept UI-agnostic so the same derivations work
 * for headers, comments, and player dialogs once those pieces move off mock
 * data too.
 */

type AuthUser = {
  id?: string
  name?: string | null
  email?: string | null
  image?: string | null
}

/** Pulls a stable display name, falling back through sensible options. */
export function displayName(user: AuthUser | null | undefined): string {
  if (!user) return "user"
  if (user.name && user.name.trim()) return user.name.trim()
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

/** Cheap deterministic hash for turning a user id into a hue. */
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

export type UserChipData = {
  name: string
  avatar: { initials: string; bg: string; fg: string; src?: string }
}

/** Convenience bundle: everything `<UserChip>` needs from an auth user. */
export function userChipData(user: AuthUser | null | undefined): UserChipData {
  const name = displayName(user)
  const { bg, fg } = avatarTint(user?.id ?? name)
  return {
    name,
    avatar: {
      initials: displayInitials(name),
      bg,
      fg,
      src: user?.image ?? undefined,
    },
  }
}
