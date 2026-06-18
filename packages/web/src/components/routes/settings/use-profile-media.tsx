import { t as tx } from "@alloy/i18n"
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
  avatar: tx("Avatar updated"),
  banner: tx("Banner updated"),
}

type ProfileMediaInput = {
  image: string
  banner: string
}

/**
 * All profile media state and mutations: avatar/banner uploads (with crop),
 * removals, the hidden file inputs, and the per-zone change/remove dropdown
 * menus.
 */
export function useProfileMedia({ image, banner }: ProfileMediaInput) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()
  const [profileImage, setProfileImage] = React.useState(image)
  const [profileBanner, setProfileBanner] = React.useState(banner)

  React.useEffect(() => {
    setProfileImage(image)
  }, [image])

  React.useEffect(() => {
    setProfileBanner(banner)
  }, [banner])

  const [uploading, setUploading] = React.useState(false)
  const [cropFile, setCropFile] = React.useState<File | null>(null)
  const [cropMode, setCropMode] = React.useState<CropMode>("avatar")
  const [cropApplying, setCropApplying] = React.useState(false)

  const avatarInputRef = React.useRef<HTMLInputElement>(null)
  const bannerInputRef = React.useRef<HTMLInputElement>(null)
  const bannerAnchor = useClickAnchor()
  const avatarAnchor = useClickAnchor()

  async function refreshProfile() {
    await refetchSession()
    await invalidateProfileIdentityCaches(queryClient)
    await router.invalidate()
  }

  function openFilePicker(mode: CropMode) {
    const ref = mode === "avatar" ? avatarInputRef : bannerInputRef
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
      } else {
        nextUser = await api.users.uploadBanner(blob)
        setProfileBanner(nextUser.banner ?? "")
      }
      toast.success(UPLOAD_SUCCESS_MESSAGE[mode])
      await refreshProfile()
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Upload failed")))
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
      toast.success(tx("Avatar removed"))
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't remove avatar")))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveBanner() {
    setUploading(true)
    try {
      const nextUser = await api.users.removeBanner()
      setProfileBanner(nextUser.banner ?? "")
      toast.success(tx("Banner removed"))
      await refreshProfile()
    } catch (cause) {
      toast.error(errorMessage(cause, tx("Couldn't remove banner")))
    } finally {
      setUploading(false)
    }
  }

  // Hidden file inputs — reused for avatar and banner.
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
    </>
  )

  function mediaMenu(kind: MediaKind) {
    const anchor = kind === "avatar" ? avatarAnchor.anchor : bannerAnchor.anchor
    const onRemove = kind === "avatar" ? handleRemoveAvatar : handleRemoveBanner
    return (
      <MediaDropdownContent
        anchor={anchor}
        kind={kind}
        onUpload={() => openFilePicker(kind)}
        onRemove={onRemove}
      />
    )
  }

  return {
    avatarAnchor,
    bannerAnchor,
    cropApplying,
    cropFile,
    cropMode,
    fileInputs,
    handleImageUpload,
    hasBanner: !!userImageSrc(profileBanner),
    mediaMenu,
    openFilePicker,
    profileBanner,
    profileImage,
    refreshProfile,
    setCropApplying,
    setCropFile,
    uploading,
  }
}
