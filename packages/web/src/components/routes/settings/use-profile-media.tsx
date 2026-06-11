import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"

import { useClickAnchor } from "@/hooks/use-click-anchor"
import { api } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { userImageSrc } from "@/lib/user-display"
import { invalidateProfileIdentityCaches } from "@/lib/user-queries"

import type { CropMode } from "./profile-image-crop-utils"
import { MediaDropdownContent, type MediaKind } from "./profile-media-controls"

const UPLOAD_SUCCESS_MESSAGE: Record<CropMode, string> = {
  avatar: "Avatar updated",
  banner: "Banner updated",
  background: "Background updated",
}

type ProfileMediaInput = {
  image: string
  banner: string
  background: string
  accentColor: string
}

/**
 * All profile media state and mutations: avatar/banner/wallpaper uploads
 * (with crop), removals, the accent color (debounced persistence), the hidden
 * file inputs, and the per-zone change/remove dropdown menus.
 */
export function useProfileMedia({
  image,
  banner,
  background,
  accentColor,
}: ProfileMediaInput) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()
  const [profileImage, setProfileImage] = React.useState(image)
  const [profileBanner, setProfileBanner] = React.useState(banner)
  const [profileBackground, setProfileBackground] = React.useState(background)
  const [profileAccent, setProfileAccent] = React.useState(accentColor)

  React.useEffect(() => {
    setProfileImage(image)
  }, [image])

  React.useEffect(() => {
    setProfileBanner(banner)
  }, [banner])

  React.useEffect(() => {
    setProfileBackground(background)
  }, [background])

  React.useEffect(() => {
    setProfileAccent(accentColor)
  }, [accentColor])

  const [uploading, setUploading] = React.useState(false)
  const [cropFile, setCropFile] = React.useState<File | null>(null)
  const [cropMode, setCropMode] = React.useState<CropMode>("avatar")
  const [cropApplying, setCropApplying] = React.useState(false)

  const avatarInputRef = React.useRef<HTMLInputElement>(null)
  const bannerInputRef = React.useRef<HTMLInputElement>(null)
  const backgroundInputRef = React.useRef<HTMLInputElement>(null)
  const bannerAnchor = useClickAnchor()
  const avatarAnchor = useClickAnchor()
  const backgroundAnchor = useClickAnchor()

  async function refreshProfile() {
    await refetchSession()
    await invalidateProfileIdentityCaches(queryClient)
    await router.invalidate()
  }

  function openFilePicker(mode: CropMode) {
    const ref =
      mode === "avatar"
        ? avatarInputRef
        : mode === "banner"
          ? bannerInputRef
          : backgroundInputRef
    ref.current?.click()
  }

  function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>,
    mode: CropMode,
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so the same file can be re-selected.
    e.target.value = ""
    setCropMode(mode)
    setCropFile(file)
  }

  async function handleImageUpload(
    blob: Blob,
    mode: CropMode,
  ): Promise<boolean> {
    setUploading(true)
    try {
      let nextUser: Awaited<ReturnType<typeof api.users.uploadAvatar>>
      if (mode === "avatar") {
        nextUser = await api.users.uploadAvatar(blob)
        setProfileImage(nextUser.image ?? "")
      } else if (mode === "banner") {
        nextUser = await api.users.uploadBanner(blob)
        setProfileBanner(nextUser.banner ?? "")
      } else {
        nextUser = await api.users.uploadBackground(blob)
        setProfileBackground(nextUser.background ?? "")
        // The server auto-derives an accent from the new wallpaper.
        setProfileAccent(nextUser.accentColor ?? "")
      }
      toast.success(UPLOAD_SUCCESS_MESSAGE[mode])
      await refreshProfile()
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, "Upload failed"))
      return false
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    setUploading(true)
    try {
      const nextUser = await api.users.removeAvatar()
      setProfileImage(nextUser.image ?? "")
      toast.success("Avatar removed")
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't remove avatar"))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveBanner() {
    setUploading(true)
    try {
      const nextUser = await api.users.removeBanner()
      setProfileBanner(nextUser.banner ?? "")
      toast.success("Banner removed")
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't remove banner"))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveBackground() {
    setUploading(true)
    try {
      const nextUser = await api.users.removeBackground()
      setProfileBackground(nextUser.background ?? "")
      // Removing the wallpaper clears its derived accent server-side too.
      setProfileAccent(nextUser.accentColor ?? "")
      toast.success("Background removed")
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't remove background"))
    } finally {
      setUploading(false)
    }
  }

  // Accent persistence is debounced because the picker fires continuously while
  // dragging — the swatch updates instantly, the server save trails it.
  const accentPersistRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (accentPersistRef.current)
        window.clearTimeout(accentPersistRef.current)
    }
  }, [])

  function persistAccent(color: string | null) {
    if (accentPersistRef.current) window.clearTimeout(accentPersistRef.current)
    accentPersistRef.current = window.setTimeout(() => {
      void api.users
        .setAccentColor(color)
        .then(async (nextUser) => {
          setProfileAccent(nextUser.accentColor ?? "")
          await refreshProfile()
        })
        .catch((cause: unknown) => {
          toast.error(errorMessage(cause, "Couldn't save accent"))
        })
    }, 450)
  }

  function handleAccentChange(hex: string) {
    setProfileAccent(hex)
    persistAccent(hex)
  }

  async function handleAutoAccent() {
    if (accentPersistRef.current) window.clearTimeout(accentPersistRef.current)
    setUploading(true)
    try {
      const nextUser = await api.users.autoAccentColor()
      setProfileAccent(nextUser.accentColor ?? "")
      toast.success("Accent matched to your wallpaper")
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update accent"))
    } finally {
      setUploading(false)
    }
  }

  async function handleClearAccent() {
    if (accentPersistRef.current) window.clearTimeout(accentPersistRef.current)
    setUploading(true)
    try {
      const nextUser = await api.users.setAccentColor(null)
      setProfileAccent(nextUser.accentColor ?? "")
      toast.success("Accent reset")
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't reset accent"))
    } finally {
      setUploading(false)
    }
  }

  // Hidden file inputs — reused for avatar, banner, and wallpaper.
  const fileInputs = (
    <>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFileSelect(e, "avatar")}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFileSelect(e, "banner")}
      />
      <input
        ref={backgroundInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFileSelect(e, "background")}
      />
    </>
  )

  function mediaMenu(kind: MediaKind) {
    const anchor =
      kind === "avatar"
        ? avatarAnchor.anchor
        : kind === "banner"
          ? bannerAnchor.anchor
          : backgroundAnchor.anchor
    const onRemove =
      kind === "avatar"
        ? handleRemoveAvatar
        : kind === "banner"
          ? handleRemoveBanner
          : handleRemoveBackground
    return (
      <MediaDropdownContent
        anchor={anchor}
        kind={kind}
        onUpload={() => openFilePicker(kind)}
        onRemove={onRemove}
      />
    )
  }

  const backgroundSrc = userImageSrc(profileBackground)

  return {
    avatarAnchor,
    backgroundAnchor,
    backgroundSrc,
    bannerAnchor,
    cropApplying,
    cropFile,
    cropMode,
    fileInputs,
    handleAccentChange,
    handleAutoAccent,
    handleClearAccent,
    handleImageUpload,
    hasBackground: !!backgroundSrc,
    hasBanner: !!userImageSrc(profileBanner),
    mediaMenu,
    openFilePicker,
    profileAccent,
    profileBanner,
    profileImage,
    refreshProfile,
    setCropApplying,
    setCropFile,
    uploading,
  }
}
