import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ChangeEvent, Dispatch, SetStateAction } from "react"

import type { CropMode } from "@/components/media/image-crop-utils"
import { useClickAnchor } from "@/hooks/use-click-anchor"
import { api } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { userImageSrc } from "@/lib/user-display"
import { invalidateProfileIdentityCaches } from "@/lib/user-queries"

import { MediaDropdownContent, type MediaKind } from "./profile-media-controls"

const UPLOAD_SUCCESS_MESSAGE: Record<CropMode, string> = {
  avatar: t("Avatar updated"),
  banner: t("Banner updated"),
  // Profile settings never pick the "thumbnail" mode; kept for exhaustiveness.
  thumbnail: t("Image updated"),
}

type ProfileMediaInput = {
  image: string
  banner: string
}

function useProfileRefresh() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()

  return useCallback(async () => {
    await refetchSession()
    await invalidateProfileIdentityCaches(queryClient)
    await router.invalidate()
  }, [queryClient, refetchSession, router])
}

function useSyncedProfileMedia({ image, banner }: ProfileMediaInput) {
  const [profileImage, setProfileImage] = useState(image)
  const [profileBanner, setProfileBanner] = useState(banner)

  useEffect(() => {
    setProfileImage(image)
  }, [image])

  useEffect(() => {
    setProfileBanner(banner)
  }, [banner])

  return {
    profileBanner,
    profileImage,
    setProfileBanner,
    setProfileImage,
  }
}

function useProfileMediaInputs({
  setCropFile,
  setCropMode,
}: {
  setCropFile: Dispatch<SetStateAction<File | null>>
  setCropMode: Dispatch<SetStateAction<CropMode>>
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  function openFilePicker(mode: CropMode) {
    const ref = mode === "avatar" ? avatarInputRef : bannerInputRef
    ref.current?.click()
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>, mode: CropMode) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so the same file can be re-selected.
    e.target.value = ""
    setCropMode(mode)
    setCropFile(file)
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

  return { fileInputs, openFilePicker }
}

function useProfileMediaMutations({
  refreshProfile,
  setProfileBanner,
  setProfileImage,
}: {
  refreshProfile: () => Promise<void>
  setProfileBanner: Dispatch<SetStateAction<string>>
  setProfileImage: Dispatch<SetStateAction<string>>
}) {
  const [uploading, setUploading] = useState(false)

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
      toast.error(errorMessage(cause, t("Upload failed")))
      return false
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    await removeProfileMedia({
      remove: api.users.removeAvatar,
      update: (nextUser) => setProfileImage(nextUser.image ?? ""),
      success: t("Avatar removed"),
      failure: t("Couldn't remove avatar"),
      refreshProfile,
      setUploading,
    })
  }

  async function handleRemoveBanner() {
    await removeProfileMedia({
      remove: api.users.removeBanner,
      update: (nextUser) => setProfileBanner(nextUser.banner ?? ""),
      success: t("Banner removed"),
      failure: t("Couldn't remove banner"),
      refreshProfile,
      setUploading,
    })
  }

  return {
    handleImageUpload,
    handleRemoveAvatar,
    handleRemoveBanner,
    uploading,
  }
}

async function removeProfileMedia({
  remove,
  update,
  success,
  failure,
  refreshProfile,
  setUploading,
}: {
  remove: () => Promise<Awaited<ReturnType<typeof api.users.removeAvatar>>>
  update: (nextUser: Awaited<ReturnType<typeof api.users.removeAvatar>>) => void
  success: string
  failure: string
  refreshProfile: () => Promise<void>
  setUploading: Dispatch<SetStateAction<boolean>>
}) {
  setUploading(true)
  try {
    const nextUser = await remove()
    update(nextUser)
    toast.success(success)
    await refreshProfile()
  } catch (cause) {
    toast.error(errorMessage(cause, failure))
  } finally {
    setUploading(false)
  }
}

/**
 * All profile media state and mutations: avatar/banner uploads (with crop),
 * removals, the hidden file inputs, and the per-zone change/remove dropdown
 * menus.
 */
export function useProfileMedia(input: ProfileMediaInput) {
  const refreshProfile = useProfileRefresh()
  const media = useSyncedProfileMedia(input)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [cropMode, setCropMode] = useState<CropMode>("avatar")
  const [cropApplying, setCropApplying] = useState(false)
  const bannerAnchor = useClickAnchor()
  const avatarAnchor = useClickAnchor()
  const { fileInputs, openFilePicker } = useProfileMediaInputs({
    setCropFile,
    setCropMode,
  })
  const mutations = useProfileMediaMutations({
    refreshProfile,
    setProfileBanner: media.setProfileBanner,
    setProfileImage: media.setProfileImage,
  })

  function mediaMenu(kind: MediaKind) {
    const anchor = kind === "avatar" ? avatarAnchor.anchor : bannerAnchor.anchor
    const onRemove =
      kind === "avatar"
        ? mutations.handleRemoveAvatar
        : mutations.handleRemoveBanner
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
    handleImageUpload: mutations.handleImageUpload,
    hasBanner: !!userImageSrc(media.profileBanner),
    mediaMenu,
    openFilePicker,
    profileBanner: media.profileBanner,
    profileImage: media.profileImage,
    refreshProfile,
    setCropApplying,
    setCropFile,
    uploading: mutations.uploading,
  }
}
