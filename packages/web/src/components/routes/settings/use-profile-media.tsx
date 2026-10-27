import { t } from "@alloy/i18n"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"
import type { ChangeEvent } from "react"

import { ImageCropDialog } from "@/components/media/image-crop-dialog"
import type { CropMode } from "@/components/media/image-crop-utils"
import { useClickAnchor } from "@/hooks/use-click-anchor"
import { api } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { refreshAfterWrite } from "@/lib/refresh-after-write"
import { userImageSrc } from "@/lib/user-display"
import { invalidateProfileIdentityCaches } from "@/lib/user-queries"

import { MediaDropdownContent, type MediaKind } from "./profile-media-controls"

// Profile settings only ever crop in "avatar" or "banner" mode; the other
// modes fall back to the generic message.
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

type ProfileMediaChange =
  | { kind: "upload"; mode: CropMode; blob: Blob }
  | { kind: "remove"; mode: CropMode }

/**
 * The shown avatar and banner: the props, overridden by an upload's response
 * until the props change. The response is the only truth if the refresh after
 * a write fails, so the override survives until then.
 */
function useSyncedProfileMedia({ image, banner }: ProfileMediaInput) {
  const [media, setMedia] = useState({ image, banner })
  const [synced, setSynced] = useState({ image, banner })
  if (synced.image !== image || synced.banner !== banner) {
    setSynced({ image, banner })
    setMedia((current) => ({
      image: synced.image !== image ? image : current.image,
      banner: synced.banner !== banner ? banner : current.banner,
    }))
  }
  return { media, setMedia }
}

function useProfileMediaInputs(onSelect: (file: File, mode: CropMode) => void) {
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
    onSelect(file, mode)
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

function changeFailure(change: ProfileMediaChange): string {
  if (change.kind === "upload") return t("Upload failed")
  return change.mode === "avatar"
    ? t("Couldn't remove avatar")
    : t("Couldn't remove banner")
}

/**
 * All profile media state and mutations: avatar/banner uploads (with crop),
 * removals, the hidden file inputs, and the per-zone change/remove dropdown
 * menus.
 */
export function useProfileMedia(input: ProfileMediaInput) {
  const refreshProfile = useProfileRefresh()
  const { media, setMedia } = useSyncedProfileMedia(input)
  // The mode outlives the file, so the dialog keeps its title while it
  // animates closed.
  const [crop, setCrop] = useState<{ file: File | null; mode: CropMode }>({
    file: null,
    mode: "avatar",
  })
  const bannerAnchor = useClickAnchor()
  const avatarAnchor = useClickAnchor()
  const { fileInputs, openFilePicker } = useProfileMediaInputs((file, mode) =>
    setCrop({ file, mode }),
  )
  const change = useMutation({
    mutationFn: (variables: ProfileMediaChange) => {
      if (variables.kind === "upload") {
        return variables.mode === "avatar"
          ? api.users.uploadAvatar(variables.blob)
          : api.users.uploadBanner(variables.blob)
      }
      return variables.mode === "avatar"
        ? api.users.removeAvatar()
        : api.users.removeBanner()
    },
    onSuccess: (nextUser, variables) => {
      setMedia((current) =>
        variables.mode === "avatar"
          ? { ...current, image: nextUser.image ?? "" }
          : { ...current, banner: nextUser.banner ?? "" },
      )
      // The write already saved; a failed refresh must not leave the crop
      // dialog open so Apply uploads the same image again.
      void refreshAfterWrite("profile", refreshProfile)
    },
  })
  const uploading = change.isPending
  const error =
    change.error && change.variables
      ? errorMessage(change.error, changeFailure(change.variables))
      : null

  function mediaMenu(kind: MediaKind) {
    const anchor = kind === "avatar" ? avatarAnchor.anchor : bannerAnchor.anchor
    const onRemove = () => change.mutate({ kind: "remove", mode: kind })
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
    inputs: (
      <>
        {fileInputs}
        <ImageCropDialog
          file={crop.file}
          mode={crop.mode}
          open={!!crop.file}
          applying={uploading}
          onOpenChange={(open) => {
            if (!open) setCrop((current) => ({ ...current, file: null }))
          }}
          onApply={async ({ blob }) => {
            // Rejects on failure, so the crop dialog stays open with the error.
            await change.mutateAsync({ kind: "upload", mode: crop.mode, blob })
            setCrop((current) => ({ ...current, file: null }))
          }}
        />
      </>
    ),
    error,
    hasBanner: !!userImageSrc(media.banner),
    mediaMenu,
    openFilePicker,
    profileBanner: media.banner,
    profileImage: media.image,
    refreshProfile,
    uploading,
  }
}
