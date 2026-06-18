import {
  LEGACY_USER_ASSET_PATH_PREFIX,
  resolvePublicUrl,
  USER_ASSET_PATH_PREFIX,
} from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import { pastelAvatarColors, pastelBannerGradient } from "@alloy/ui/lib/pastel"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { apiOrigin } from "./env"

type DisplayUser = {
  id?: string
  username?: string | null
  displayUsername?: string | null
  email?: string | null
  image?: string | null
  banner?: string | null
}

const USER_ASSET_PATH_PREFIXES = [
  USER_ASSET_PATH_PREFIX,
  LEGACY_USER_ASSET_PATH_PREFIX,
] as const
const userImageSrcCache = new Map<string, string>()
const loadedUserBannerSrcs = new Set<string>()

function displayUsername(username: string): string {
  const value = username.trim()
  return value.startsWith("@") ? value : `@${value}`
}

export function userImageSrc(
  src: string | null | undefined,
): string | undefined {
  const value = src?.trim()
  if (!value) return undefined
  const cached = userImageSrcCache.get(value)
  if (cached) return cached

  const matchingPathPrefix = USER_ASSET_PATH_PREFIXES.find((prefix) =>
    value.startsWith(prefix),
  )
  if (matchingPathPrefix) {
    const normalized = normalizeUserAssetPath(value, matchingPathPrefix)
    userImageSrcCache.set(value, normalized)
    return normalized
  }

  if (value.startsWith("/")) {
    userImageSrcCache.set(value, value)
    return value
  }

  try {
    const url = new URL(value)
    const urlPathPrefix = USER_ASSET_PATH_PREFIXES.find((prefix) =>
      url.pathname.startsWith(prefix),
    )
    if (urlPathPrefix) {
      const normalized = normalizeUserAssetPath(
        `${url.pathname}${url.search}${url.hash}`,
        urlPathPrefix,
      )
      userImageSrcCache.set(value, normalized)
      return normalized
    }
  } catch {
    // Non-URL values fall through unchanged so upstream data can still render.
  }

  userImageSrcCache.set(value, value)
  return value
}

function normalizeUserAssetPath(value: string, prefix: string): string {
  const nextPath =
    prefix === LEGACY_USER_ASSET_PATH_PREFIX
      ? `${USER_ASSET_PATH_PREFIX}${value.slice(prefix.length)}`
      : value
  return resolvePublicUrl(nextPath, apiOrigin())
}

/**
 * Pulls a stable display label from the handle, then the email local part.
 */
export function displayName(user: DisplayUser | null | undefined): string {
  if (!user) return tx("user")
  if (user.displayUsername && user.displayUsername.trim()) {
    return displayUsername(user.displayUsername)
  }
  if (user.username && user.username.trim()) {
    return displayUsername(user.username)
  }
  if (user.email) return user.email.split("@")[0] ?? "user"
  return tx("user")
}

/** Up to two uppercase letters from a stable user identity. */
function displayInitials(value: string): string {
  const parts = value
    .replace(/^@+/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) {
    return (parts[0] ?? "?").slice(0, 2).toUpperCase()
  }
  const [first = "?", second = ""] = parts
  return `${first[0] ?? "?"}${second[0] ?? ""}`.toUpperCase()
}

function avatarInitialsSource(user: DisplayUser | null | undefined): string {
  if (user?.username && user.username.trim()) return user.username.trim()
  if (user?.displayUsername && user.displayUsername.trim()) {
    return user.displayUsername.trim()
  }
  if (user?.email && user.email.trim()) return user.email.split("@")[0] ?? ""
  return displayName(user)
}

/** Avatar tint derived from user id (or display label as fallback) so each user is visually distinct. */
function avatarTint(seed: string): { bg: string; fg: string } {
  return pastelAvatarColors(seed || "user")
}

export type UserAvatar = {
  src?: string
  initials: string
  bg: string
  fg: string
}

function userAvatarSrc(
  user: DisplayUser | null | undefined,
): string | undefined {
  return userImageSrc(user?.image)
}

/**
 * Everything needed to render an avatar for a user. `src` may be undefined
 * (show `initials` in an `AvatarFallback` with the `bg`/`fg` tint).
 */
export function userAvatar(user: DisplayUser | null | undefined): UserAvatar {
  const name = displayName(user)
  const initialsSource = avatarInitialsSource(user)
  const { bg, fg } = avatarTint(user?.id ?? name)
  return {
    src: userAvatarSrc(user),
    initials: displayInitials(initialsSource),
    bg,
    fg,
  }
}

export type UserChipData = {
  name: string
  avatar: UserAvatar
}

export function userChipData(
  user: DisplayUser | null | undefined,
): UserChipData {
  return { name: displayName(user), avatar: userAvatar(user) }
}

export function useUserChipData(
  user: DisplayUser | null | undefined,
): UserChipData {
  return userChipData(user)
}

export function UserBanner({
  user,
  className,
}: {
  user: DisplayUser | null | undefined
  className?: string
}) {
  // Only a dedicated banner image is rendered — there is no avatar-derived
  // fallback. Callers that want a different empty state (e.g. the frosted
  // profile header) check `user.banner` themselves and render their own.
  const bannerSrc = userImageSrc(user?.banner)
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 overflow-hidden rounded-[inherit]",
        className,
      )}
      style={{
        background: pastelBannerGradient(user?.id ?? displayName(user)),
      }}
    >
      {bannerSrc ? <UserBannerImage src={bannerSrc} /> : null}
    </div>
  )
}

function UserBannerImage({ src }: { src: string }) {
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    () => (loadedUserBannerSrcs.has(src) ? "loaded" : "loading"),
  )

  React.useEffect(() => {
    setStatus(loadedUserBannerSrcs.has(src) ? "loaded" : "loading")
  }, [src])

  return (
    <>
      <img
        key={src}
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        fetchPriority="high"
        loading="eager"
        onLoad={() => {
          loadedUserBannerSrcs.add(src)
          setStatus("loaded")
        }}
        onError={() => setStatus("error")}
        className={cn(
          "absolute inset-0 size-full rounded-[inherit] object-cover brightness-90 transition-opacity duration-150",
          status === "loaded" ? "opacity-100" : "opacity-0",
        )}
      />
      {status === "loading" ? (
        <div
          aria-hidden
          className="bg-muted absolute inset-0 rounded-[inherit]"
        />
      ) : null}
    </>
  )
}
