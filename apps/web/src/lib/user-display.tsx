import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type AuthUser = {
  id?: string
  name?: string | null
  username?: string | null
  displayUsername?: string | null
  email?: string | null
  image?: string | null
  banner?: string | null
}

const USER_ASSET_PATH_PREFIX = "/storage/user-assets/"

function displayUsername(username: string): string {
  const value = username.trim()
  return value.startsWith("@") ? value : `@${value}`
}

export function userImageSrc(
  src: string | null | undefined
): string | undefined {
  const value = src?.trim()
  if (!value) return undefined

  if (value.startsWith(USER_ASSET_PATH_PREFIX)) return value
  if (value.startsWith("/")) return value

  try {
    const url = new URL(value)
    if (url.pathname.startsWith(USER_ASSET_PATH_PREFIX)) {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    // Non-URL values fall through unchanged so upstream data can still render.
  }

  return value
}

/**
 * Pulls a stable display name. Prefers the free-form `name` (what the user
 * actually wants to be called), then the handle, then the email local part.
 */
export function displayName(user: AuthUser | null | undefined): string {
  if (!user) return "user"
  if (user.name && user.name.trim()) return user.name.trim()
  if (user.displayUsername && user.displayUsername.trim()) {
    return displayUsername(user.displayUsername)
  }
  if (user.username && user.username.trim())
    return displayUsername(user.username)
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

export function userAvatarSrc(
  user: AuthUser | null | undefined
): string | undefined {
  return userImageSrc(user?.image)
}

/**
 * Everything needed to render an avatar for a user. `src` may be undefined
 * (show `initials` in an `AvatarFallback` with the `bg`/`fg` tint).
 */
export function userAvatar(user: AuthUser | null | undefined): UserAvatar {
  const name = displayName(user)
  const { bg, fg } = avatarTint(user?.id ?? name)
  return {
    src: userAvatarSrc(user),
    initials: displayInitials(name),
    bg,
    fg,
  }
}

export type UserBannerData = {
  src?: string
  bg: string
}

export function userBanner(user: AuthUser | null | undefined): UserBannerData {
  const name = displayName(user)
  const { bg } = avatarTint(user?.id ?? name)
  return {
    src: userImageSrc(user?.banner) ?? userAvatarSrc(user),
    bg,
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
  const banner = userBanner(user)
  // When using a dedicated banner image, render it clean. When falling back
  // to the avatar image, zoom & desaturate it so it reads as a backdrop.
  const hasDedicatedBanner = !!userImageSrc(user?.banner)
  return (
    <div
      aria-hidden
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{ backgroundColor: banner.bg }}
    >
      {banner.src ? (
        <UserBannerImage
          src={banner.src}
          hasDedicatedBanner={hasDedicatedBanner}
        />
      ) : null}
    </div>
  )
}

function UserBannerImage({
  src,
  hasDedicatedBanner,
}: {
  src: string
  hasDedicatedBanner: boolean
}) {
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    "loading"
  )

  React.useEffect(() => {
    setStatus("loading")
  }, [src])

  return (
    <>
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        fetchPriority="high"
        loading="eager"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-150",
          status === "loaded" ? "opacity-100" : "opacity-0",
          hasDedicatedBanner
            ? "brightness-90"
            : "scale-150 brightness-75 saturate-150"
        )}
      />
      {status === "loading" ? (
        <div aria-hidden className="absolute inset-0 bg-muted" />
      ) : null}
    </>
  )
}
