import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { USER_DISPLAY_NAME_MAX_LENGTH } from "@workspace/api/auth"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@workspace/ui/components/section"
import { toast } from "@workspace/ui/lib/toast"
import { Pencil, SaveIcon } from "lucide-react"
import * as React from "react"

import { LimitedInput } from "@/components/form/limited-field"
import { useClickAnchor } from "@/hooks/use-click-anchor"
import { api } from "@/lib/api"
import { authClient, useSession } from "@/lib/auth-client"
import { PROFILE_BANNER_ASPECT } from "@/lib/banner-layout"
import { errorMessage } from "@/lib/error-message"
import {
  validateEmail,
  validateRequiredString,
  validateUsername,
} from "@/lib/form-validators"
import {
  normalizeProfileIdentity,
  profileIdentityChanged,
  profileIdentityPatch,
} from "@/lib/profile-identity"
import {
  displayName,
  userAvatar,
  UserBanner,
  userImageSrc,
} from "@/lib/user-display"
import { invalidateProfileIdentityCaches } from "@/lib/user-queries"

import { ProfileImageCropDialog } from "./profile-image-crop-dialog"
import {
  MediaDropdownContent,
  MediaEditOverlay,
} from "./profile-media-controls"
import { ProfileTextField } from "./profile-text-field"

type ProfileCardProps = {
  userId: string
  initialName: string
  initialUsername: string
  image: string
  banner: string
  email: string
}

type ProfileAvatarPreviewProps = {
  avatar: ReturnType<typeof userAvatar>
  previewName: string
  showImage: boolean
}

type IdentityTextFieldConfig = {
  autoComplete: string
  description?: React.ReactNode
  label: string
  name: "username" | "email"
  onChangeValue?: (value: string) => string
  type: "email" | "text"
  validate: (value: string) => string | undefined
}

function ProfileAvatarPreview({
  avatar,
  previewName,
  showImage,
}: ProfileAvatarPreviewProps) {
  const style = { background: avatar.bg, color: avatar.fg }

  return (
    <Avatar size="xl" style={style}>
      {showImage && avatar.src ? (
        <AvatarImage
          src={avatar.src}
          alt={previewName}
          fetchPriority="high"
          loading="eager"
        />
      ) : null}
      <AvatarFallback style={style}>{avatar.initials}</AvatarFallback>
    </Avatar>
  )
}

function renderProfileMediaMenu({
  anchor,
  kind,
  onUpload,
  onRemove,
}: React.ComponentProps<typeof MediaDropdownContent>) {
  return (
    <MediaDropdownContent
      anchor={anchor}
      kind={kind}
      onUpload={onUpload}
      onRemove={onRemove}
    />
  )
}

function profileMediaMenuProps(
  anchor: React.ComponentProps<typeof MediaDropdownContent>["anchor"],
  kind: "avatar" | "banner",
  onUpload: () => void,
  onRemove: () => void,
): React.ComponentProps<typeof MediaDropdownContent> {
  return { anchor, kind, onUpload, onRemove }
}

function ProfileMediaEditButton({
  className,
  disabled,
  onClick,
  children,
}: {
  className: string
  disabled: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
      <MediaEditOverlay>
        <Pencil className="size-4 text-white" />
      </MediaEditOverlay>
    </button>
  )
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
  const initialIdentity = {
    email,
    name: initialName,
    username: initialUsername,
  }
  const hasBanner = !!userImageSrc(profileBanner)
  const form = useForm({
    defaultValues: initialIdentity,
    onSubmit: async ({ value }) => {
      const patch = profileIdentityPatch(value, initialIdentity)
      if (Object.keys(patch).length === 0) {
        return
      }

      try {
        const { error } = await authClient.updateUser(patch)
        if (error) {
          toast.error(errorMessage(error, "Couldn't save"))
          return
        }

        toast.success("Saved")
        await refreshProfile()
      } catch (cause) {
        toast.error(errorMessage(cause, "Something went wrong"))
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

  const [uploading, setUploading] = React.useState(false)
  const [cropFile, setCropFile] = React.useState<File | null>(null)
  const [cropMode, setCropMode] = React.useState<"avatar" | "banner">("avatar")
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

  function openFilePicker(mode: "avatar" | "banner") {
    const ref = mode === "avatar" ? avatarInputRef : bannerInputRef
    ref.current?.click()
  }

  function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>,
    mode: "avatar" | "banner",
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
    mode: "avatar" | "banner",
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
      toast.success(mode === "avatar" ? "Avatar updated" : "Banner updated")
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

  function mediaMenu(kind: "avatar" | "banner") {
    return kind === "avatar"
      ? renderProfileMediaMenu(
          profileMediaMenuProps(
            avatarAnchor.anchor,
            kind,
            () => openFilePicker(kind),
            handleRemoveAvatar,
          ),
        )
      : renderProfileMediaMenu(
          profileMediaMenuProps(
            bannerAnchor.anchor,
            kind,
            () => openFilePicker(kind),
            handleRemoveBanner,
          ),
        )
  }

  function mediaEditButton(
    kind: "avatar" | "banner",
    children?: React.ReactNode,
  ) {
    return (
      <ProfileMediaEditButton
        disabled={uploading}
        onClick={() => openFilePicker(kind)}
        className={
          kind === "avatar"
            ? "group focus-visible:outline-accent relative size-12 shrink-0 overflow-hidden rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
            : "group focus-visible:outline-accent absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
        }
      >
        {children}
      </ProfileMediaEditButton>
    )
  }

  const identityTextFields: ReadonlyArray<IdentityTextFieldConfig> = [
    {
      autoComplete: "username",
      label: "Username",
      name: "username",
      type: "text",
      validate: validateUsername,
    },
    {
      autoComplete: "email",
      label: "Email",
      name: "email",
      onChangeValue: undefined,
      type: "email",
      validate: validateEmail,
    },
  ]

  return (
    <>
      {fileInputs}
      <ProfileImageCropDialog
        file={cropFile}
        mode={cropMode}
        open={!!cropFile}
        applying={uploading}
        onApplyingChange={setCropApplying}
        onOpenChange={(open) => {
          if (!open && !uploading && !cropApplying) {
            setCropFile(null)
          }
        }}
        onApply={async (blob) => {
          const uploaded = await handleImageUpload(blob, cropMode)
          if (uploaded) {
            setCropFile(null)
          }
        }}
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
            <div>
              <div
                className="relative min-h-[80px] overflow-hidden rounded-lg"
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
                      className="group focus-visible:outline-accent absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
                      onPointerDown={bannerAnchor.onTriggerPointerDown}
                    >
                      <MediaEditOverlay>
                        <Pencil className="size-4 text-white" />
                      </MediaEditOverlay>
                    </DropdownMenuTrigger>
                    {mediaMenu("banner")}
                  </DropdownMenu>
                ) : (
                  mediaEditButton("banner")
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
                const normalizedIdentity = normalizeProfileIdentity({
                  email: currentEmail,
                  name: currentName,
                  username: initialUsername,
                })
                const previewName = displayName({
                  id: userId,
                  name: normalizedIdentity.name || null,
                  email: normalizedIdentity.email || email,
                  image: profileImage || null,
                })
                const avatar = userAvatar({
                  id: userId,
                  name: normalizedIdentity.name || null,
                  email: normalizedIdentity.email || email,
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
                          className="group focus-visible:outline-accent relative inline-flex size-12 shrink-0 overflow-hidden rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
                          onPointerDown={avatarAnchor.onTriggerPointerDown}
                        >
                          <ProfileAvatarPreview
                            avatar={avatar}
                            previewName={previewName}
                            showImage
                          />
                          <MediaEditOverlay>
                            <Pencil className="size-4 text-white" />
                          </MediaEditOverlay>
                        </DropdownMenuTrigger>
                        {mediaMenu("avatar")}
                      </DropdownMenu>
                    ) : (
                      mediaEditButton(
                        "avatar",
                        <ProfileAvatarPreview
                          avatar={avatar}
                          previewName={previewName}
                          showImage={false}
                        />,
                      )
                    )}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground text-sm font-medium">
                        {previewName}
                      </span>
                      <span className="text-foreground-faint text-sm">
                        {normalizedIdentity.email || email}
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
                      maxLength={USER_DISPLAY_NAME_MAX_LENGTH}
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

            {identityTextFields.map((config) => (
              <form.Field
                key={config.name}
                name={config.name}
                validators={{
                  onChange: ({ value }) => config.validate(value),
                }}
              >
                {(field) => (
                  <ProfileTextField
                    field={field}
                    label={config.label}
                    type={config.type}
                    autoComplete={config.autoComplete}
                    isSubmitting={form.state.isSubmitting}
                    submissionAttempts={form.state.submissionAttempts}
                    onChangeValue={config.onChangeValue}
                    description={config.description}
                  />
                )}
              </form.Field>
            ))}
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
                const dirty = profileIdentityChanged(
                  {
                    email: currentEmail,
                    name: currentName,
                    username: currentUsername,
                  },
                  initialIdentity,
                )

                return (
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!dirty || !canSubmit}
                  >
                    <SaveIcon />
                    {isSubmitting ? "Saving…" : "Save"}
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
