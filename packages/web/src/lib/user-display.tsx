import { resolvePublicUrl, USER_ASSET_PATH_PREFIX } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { pastelAvatarColors, pastelBannerGradient } from "@alloy/ui/lib/pastel"
import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

import { apiOrigin } from "./env"

type DisplayUser = {
  id?: string
  username?: string | null
  displayName?: string | null
  image?: string | null
  banner?: string | null
}

const userImageSrcCache = new Map<string, string>()

export function userImageSrc(
  src: string | null | undefined,
): string | undefined {
  const value = src?.trim()
  if (!value) return undefined
  const cached = userImageSrcCache.get(value)
  if (cached) return cached

  if (value.startsWith(USER_ASSET_PATH_PREFIX)) {
    const normalized = normalizeUserAssetPath(value)
    userImageSrcCache.set(value, normalized)
    return normalized
  }

  if (value.startsWith("/")) {
    userImageSrcCache.set(value, value)
    return value
  }

  userImageSrcCache.set(value, value)
  return value
}

function normalizeUserAssetPath(value: string): string {
  return resolvePublicUrl(value, apiOrigin())
}

/**
 * Pulls a stable display label from the chosen display name, then the handle.
 */
export function displayName(user: DisplayUser | null | undefined): string {
  if (!user) return t("user")
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim()
  }
  if (user.username && user.username.trim()) {
    return user.username.trim()
  }
  return t("user")
}

export type UserAvatar = {
  src?: string
  bg: string
  fg: string
}

/**
 * Everything needed to render an avatar for a user. `src` may be undefined
 * (show an `AvatarFallback` tinted with `bg`/`fg`). The tint is derived from
 * the user id (or display label as fallback) so each user stays distinct.
 */
export function userAvatar(user: DisplayUser | null | undefined): UserAvatar {
  const tint = pastelAvatarColors(user?.id ?? displayName(user))
  return {
    src: userImageSrc(user?.image),
    bg: tint.bg,
    fg: tint.fg,
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

/** A user avatar tinted with the user's colors behind the image and icon. */
export function TintedAvatar({
  avatar,
  alt = "",
  size,
  className,
}: {
  avatar: UserAvatar
  alt?: string
  size?: ComponentProps<typeof Avatar>["size"]
  className?: string
}) {
  const tint = { background: avatar.bg, color: avatar.fg }
  return (
    <Avatar size={size} className={className} style={tint}>
      {avatar.src ? <AvatarImage src={avatar.src} alt={alt} /> : null}
      <AvatarFallback style={tint} />
    </Avatar>
  )
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
  const image = useImageLoaded(src)

  return (
    <>
      <img
        key={src}
        ref={image.ref}
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        fetchPriority="high"
        loading="eager"
        onLoad={image.markLoaded}
        onError={image.markError}
        className={cn(
          "absolute inset-0 size-full rounded-[inherit] object-cover brightness-90 transition-opacity duration-150",
          image.status === "loaded" ? "opacity-100" : "opacity-0",
        )}
      />
      {image.status === "loading" ? (
        <div
          aria-hidden
          className="bg-muted absolute inset-0 rounded-[inherit]"
        />
      ) : null}
    </>
  )
}
