import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { Camera, Pencil } from "lucide-react"
import { useClickAnchor } from "@/hooks/use-click-anchor"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@workspace/ui/components/section"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/lib/toast"

import { LimitedInput } from "@/components/form/limited-field"
import {
  ImageCropDialog,
  type ImageCropMode,
} from "@/components/profile/image-crop-dialog"
import { api } from "@/lib/api"
import { authClient, useSession } from "@/lib/auth-client"
import { PROFILE_BANNER_ASPECT } from "@/lib/banner-layout"
import { clipKeys } from "@/lib/clip-queries"
import { feedKeys } from "@/lib/feed-queries"
import {
  validateEmail,
  validateRequiredString,
  validateUsername,
} from "@/lib/form-validators"
import { gameKeys } from "@/lib/game-queries"
import { searchKeys } from "@/lib/search-api"
import {
  UserBanner,
  displayName,
  userAvatar,
  userImageSrc,
} from "@/lib/user-display"
import {
  MediaDropdownContent,
  MediaEditOverlay,
} from "./profile-media-controls"

import { userKeys } from "@/lib/user-queries"

type ProfileCardProps = {
  userId: string
  initialName: string
  initialUsername: string
  image: string
  banner: string
  email: string
}

export function ProfileCard({
  userId,
  initialName,
  initialUsername,
  image,
  banner,
  email,
}: ProfileCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()
  const [profileImage, setProfileImage] = React.useState(image)
  const [profileBanner, setProfileBanner] = React.useState(banner)
  const bannerUser = {
    id: userId,
    image: profileImage || null,
    banner: profileBanner || null,
  }
  const hasBanner = !!userImageSrc(profileBanner)
  const form = useForm({
    defaultValues: {
      email,
      name: initialName,
      username: initialUsername,
    } as { email: string; name: string; username: string },
    onSubmit: async ({ value }) => {
      const trimmedEmail = value.email.trim()
      const trimmedName = value.name.trim()
      const trimmedUsername = value.username.trim()
      const emailDirty =
        trimmedEmail.toLowerCase() !== email.trim().toLowerCase()
      const nameDirty = trimmedName !== initialName.trim()
      const usernameDirty = trimmedUsername !== initialUsername.trim()

      if (!emailDirty && !nameDirty && !usernameDirty) {
        return
      }

      try {
        const { error } = await authClient.updateUser({
          ...(emailDirty ? { email: trimmedEmail } : {}),
          ...(nameDirty ? { name: trimmedName } : {}),
          ...(usernameDirty ? { username: trimmedUsername } : {}),
        })
        if (error) {
          toast.error(error.message ?? "Couldn't save")
          return
        }

        toast.success("Saved")
        await router.invalidate()
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Something went wrong"
        )
      }
    },
  })

  React.useEffect(() => {
    form.reset({
      email,
      name: initialName,
      username: initialUsername,
    })
  }, [email, form, initialName, initialUsername])

  React.useEffect(() => {
    setProfileImage(image)
  }, [image])

  React.useEffect(() => {
    setProfileBanner(banner)
  }, [banner])

  const [cropFile, setCropFile] = React.useState<File | null>(null)
  const [cropMode, setCropMode] = React.useState<ImageCropMode>("avatar")
  const [uploading, setUploading] = React.useState(false)

  const avatarInputRef = React.useRef<HTMLInputElement>(null)
  const bannerInputRef = React.useRef<HTMLInputElement>(null)
  const bannerAnchor = useClickAnchor()
  const avatarAnchor = useClickAnchor()

  async function refreshProfile() {
    await refetchSession()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: userKeys.all }),
      queryClient.invalidateQueries({ queryKey: clipKeys.all }),
      queryClient.invalidateQueries({ queryKey: feedKeys.all }),
      queryClient.invalidateQueries({ queryKey: gameKeys.all }),
      queryClient.invalidateQueries({ queryKey: searchKeys.all }),
    ])
    await router.invalidate()
  }

  function openFilePicker(mode: ImageCropMode) {
    const ref = mode === "avatar" ? avatarInputRef : bannerInputRef
    ref.current?.click()
  }

  function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>,
    mode: ImageCropMode
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setCropMode(mode)
    setCropFile(file)
    // Reset the input so the same file can be re-selected.
    e.target.value = ""
  }

  async function handleCropConfirm(blob: Blob) {
    setCropFile(null)
    setUploading(true)
    try {
      let nextUser: Awaited<ReturnType<typeof api.users.uploadAvatar>>
      if (cropMode === "avatar") {
        nextUser = await api.users.uploadAvatar(blob)
        setProfileImage(nextUser.image ?? "")
      } else {
        nextUser = await api.users.uploadBanner(blob)
        setProfileBanner(nextUser.banner ?? "")
      }
      toast.success(cropMode === "avatar" ? "Avatar updated" : "Banner updated")
      await refreshProfile()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Upload failed")
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
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove avatar"
      )
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
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove banner"
      )
    } finally {
      setUploading(false)
    }
  }

  // Hidden file inputs — reused for both avatar and banner.
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

  return (
    <>
      {fileInputs}
      <ImageCropDialog
        file={cropFile}
        mode={cropMode}
        onConfirm={handleCropConfirm}
        onCancel={() => setCropFile(null)}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <Section>
          <SectionContent className="flex flex-col gap-4">
            {/* Banner preview */}
            <div className="relative overflow-hidden rounded-lg">
              <div
                className="relative min-h-[80px]"
                style={{ aspectRatio: PROFILE_BANNER_ASPECT }}
              >
                <UserBanner user={bannerUser} />
                {hasBanner ? (
                  <DropdownMenu
                    open={bannerAnchor.open}
                    onOpenChange={bannerAnchor.onOpenChange}
                  >
                    <DropdownMenuTrigger
                      disabled={uploading}
                      className="group absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onPointerDown={bannerAnchor.onTriggerPointerDown}
                    >
                      <MediaEditOverlay radius="lg">
                        <Pencil className="size-4 text-white" />
                      </MediaEditOverlay>
                    </DropdownMenuTrigger>
                    <MediaDropdownContent
                      anchor={bannerAnchor.anchor}
                      kind="banner"
                      onUpload={() => openFilePicker("banner")}
                      onRemove={handleRemoveBanner}
                    />
                  </DropdownMenu>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => openFilePicker("banner")}
                    className="group absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <MediaEditOverlay radius="lg">
                      <Camera className="size-4 text-white" />
                    </MediaEditOverlay>
                  </button>
                )}
              </div>
            </div>

            {/* Avatar + identity */}
            <form.Subscribe
              selector={(state) =>
                [state.values.email, state.values.name] as const
              }
            >
              {([currentEmail, currentName]) => {
                const previewName = displayName({
                  id: userId,
                  name: currentName.trim() || null,
                  email: currentEmail.trim() || email,
                  image: profileImage || null,
                })
                const avatar = userAvatar({
                  id: userId,
                  name: currentName.trim() || null,
                  email: currentEmail.trim() || email,
                  image: profileImage || null,
                })
                const hasAvatar = !!avatar.src

                return (
                  <div className="flex items-center gap-4">
                    {hasAvatar ? (
                      <DropdownMenu
                        open={avatarAnchor.open}
                        onOpenChange={avatarAnchor.onOpenChange}
                      >
                        <DropdownMenuTrigger
                          disabled={uploading}
                          className="group relative inline-flex size-12 shrink-0 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          onPointerDown={avatarAnchor.onTriggerPointerDown}
                        >
                          <Avatar
                            size="xl"
                            style={{ background: avatar.bg, color: avatar.fg }}
                          >
                            <AvatarImage
                              src={avatar.src}
                              alt={previewName}
                              fetchPriority="high"
                              loading="eager"
                            />
                            <AvatarFallback
                              style={{
                                background: avatar.bg,
                                color: avatar.fg,
                              }}
                            >
                              {avatar.initials}
                            </AvatarFallback>
                          </Avatar>
                          <MediaEditOverlay radius="md">
                            <Pencil className="size-4 text-white" />
                          </MediaEditOverlay>
                        </DropdownMenuTrigger>
                        <MediaDropdownContent
                          anchor={avatarAnchor.anchor}
                          kind="avatar"
                          onUpload={() => openFilePicker("avatar")}
                          onRemove={handleRemoveAvatar}
                        />
                      </DropdownMenu>
                    ) : (
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => openFilePicker("avatar")}
                        className="group relative size-12 shrink-0 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Avatar
                          size="xl"
                          style={{ background: avatar.bg, color: avatar.fg }}
                        >
                          <AvatarFallback
                            style={{ background: avatar.bg, color: avatar.fg }}
                          >
                            {avatar.initials}
                          </AvatarFallback>
                        </Avatar>
                        <MediaEditOverlay radius="md">
                          <Camera className="size-4 text-white" />
                        </MediaEditOverlay>
                      </button>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {previewName}
                      </span>
                      <span className="text-sm text-foreground-faint">
                        {currentEmail.trim() || email}
                      </span>
                    </div>
                  </div>
                )
              }}
            </form.Subscribe>

            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) =>
                  validateRequiredString(value, "Display name"),
              }}
            >
              {(field) => {
                const showError =
                  field.state.meta.isTouched ||
                  form.state.submissionAttempts > 0
                const invalid = showError && !field.state.meta.isValid

                return (
                  <Field>
                    <FieldLabel htmlFor={field.name} required>
                      Display name
                    </FieldLabel>
                    <LimitedInput
                      id={field.name}
                      type="text"
                      autoComplete="name"
                      value={field.state.value}
                      maxLength={128}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={form.state.isSubmitting}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? `${field.name}-error` : undefined
                      }
                    />
                    <FieldError
                      id={`${field.name}-error`}
                      errors={showError ? field.state.meta.errors : undefined}
                    />
                  </Field>
                )
              }}
            </form.Field>

            <form.Field
              name="username"
              validators={{
                onChange: ({ value }) => validateUsername(value.trim()),
              }}
            >
              {(field) => {
                const showError =
                  field.state.meta.isTouched ||
                  form.state.submissionAttempts > 0
                const invalid = showError && !field.state.meta.isValid

                return (
                  <Field>
                    <FieldLabel htmlFor={field.name} required>
                      Username
                    </FieldLabel>
                    <Input
                      id={field.name}
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.value.toLowerCase())
                      }
                      disabled={form.state.isSubmitting}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? `${field.name}-error` : undefined
                      }
                    />
                    <FieldDescription>
                      Lowercase letters, numbers, underscores and hyphens. Used
                      in your profile URL.
                    </FieldDescription>
                    <FieldError
                      id={`${field.name}-error`}
                      errors={showError ? field.state.meta.errors : undefined}
                    />
                  </Field>
                )
              }}
            </form.Field>

            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => validateEmail(value),
              }}
            >
              {(field) => {
                const showError =
                  field.state.meta.isTouched ||
                  form.state.submissionAttempts > 0
                const invalid = showError && !field.state.meta.isValid

                return (
                  <Field>
                    <FieldLabel htmlFor={field.name} required>
                      Email
                    </FieldLabel>
                    <Input
                      id={field.name}
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={form.state.isSubmitting}
                      aria-invalid={invalid || undefined}
                      aria-describedby={
                        invalid ? `${field.name}-error` : `${field.name}-hint`
                      }
                    />
                    <FieldDescription id={`${field.name}-hint`}>
                      Updates immediately without email verification.
                    </FieldDescription>
                    <FieldError
                      id={`${field.name}-error`}
                      errors={showError ? field.state.meta.errors : undefined}
                    />
                  </Field>
                )
              }}
            </form.Field>
          </SectionContent>

          <SectionFooter>
            <form.Subscribe
              selector={(state) =>
                [
                  state.values.name,
                  state.values.username,
                  state.values.email,
                  state.canSubmit,
                  state.isSubmitting,
                ] as const
              }
            >
              {([
                currentName,
                currentUsername,
                currentEmail,
                canSubmit,
                isSubmitting,
              ]) => {
                const dirty =
                  currentName.trim() !== initialName.trim() ||
                  currentUsername.trim() !== initialUsername.trim() ||
                  currentEmail.trim().toLowerCase() !==
                    email.trim().toLowerCase()

                return (
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!dirty || !canSubmit}
                  >
                    {isSubmitting ? "Saving…" : "Save changes"}
                  </Button>
                )
              }}
            </form.Subscribe>
          </SectionFooter>
        </Section>
      </form>
    </>
  )
}
