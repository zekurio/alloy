import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { Avatar, AvatarFallback, AvatarImage } from "alloy-ui/components/avatar"
import { Button } from "alloy-ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "alloy-ui/components/dropdown-menu"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "alloy-ui/components/section"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import { ImageIcon, Pencil, SaveIcon } from "lucide-react"
import * as React from "react"

import { ColorPicker } from "@/components/form/color-picker"
import { useClickAnchor } from "@/hooks/use-click-anchor"
import { api } from "@/lib/api"
import { authClient, useSession } from "@/lib/auth-client"
import { PROFILE_BANNER_ASPECT_CLASS } from "@/lib/banner-layout"
import { errorMessage } from "@/lib/error-message"
import { validateEmail, validateUsername } from "@/lib/form-validators"
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
import type { CropMode } from "./profile-image-crop-utils"
import {
  MediaDropdownContent,
  MediaEditOverlay,
  type MediaKind,
} from "./profile-media-controls"
import { ProfileTextField } from "./profile-text-field"

type ProfileCardProps = {
  userId: string
  initialUsername: string
  image: string
  banner: string
  background: string
  accentColor: string
  email: string
}

/** The app's default lavender accent, shown when the user hasn't set one. */
const DEFAULT_ACCENT = "#d0c4eb"

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
  kind: MediaKind,
  onUpload: () => void,
  onRemove: () => void,
): React.ComponentProps<typeof MediaDropdownContent> {
  return { anchor, kind, onUpload, onRemove }
}

/** Centered pencil overlay shown on hover for the banner and avatar zones. */
const CENTER_EDIT_OVERLAY = (
  <MediaEditOverlay>
    <Pencil className="size-4 text-white" />
  </MediaEditOverlay>
)

/**
 * Corner pencil overlay for the wallpaper zone — the centered variant would sit
 * behind the floating card, so this pins the affordance to a visible corner.
 */
const CORNER_EDIT_OVERLAY = (
  <div className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity group-hover:opacity-100">
    <div className="absolute inset-0 rounded-[inherit] bg-[oklch(12%_0.01_250)]/40" />
    <span className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-[oklch(12%_0.01_250)]/55 ring-1 ring-white/15">
      <Pencil className="size-3.5 text-white" />
    </span>
  </div>
)

const UPLOAD_SUCCESS_MESSAGE: Record<CropMode, string> = {
  avatar: "Avatar updated",
  banner: "Banner updated",
  background: "Background updated",
}

export function ProfileCard({
  userId,
  initialUsername,
  image,
  banner,
  background,
  accentColor,
  email,
}: ProfileCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { refetch: refetchSession } = useSession()
  const [profileImage, setProfileImage] = React.useState(image)
  const [profileBanner, setProfileBanner] = React.useState(banner)
  const [profileBackground, setProfileBackground] = React.useState(background)
  const [profileAccent, setProfileAccent] = React.useState(accentColor)
  const bannerUser = {
    id: userId,
    image: profileImage || null,
    banner: profileBanner || null,
  }
  const initialIdentity = {
    email,
    username: initialUsername,
  }
  const hasBanner = !!userImageSrc(profileBanner)
  const backgroundSrc = userImageSrc(profileBackground)
  const hasBackground = !!backgroundSrc
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
      username: initialUsername,
    })
  }, [email, form, initialUsername])

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
    return renderProfileMediaMenu(
      profileMediaMenuProps(anchor, kind, () => openFilePicker(kind), onRemove),
    )
  }

  // A clickable region in the live profile preview. When the element already
  // has an image, clicking opens the change/remove menu; otherwise it opens the
  // file picker directly. `children` is the rendered element, `overlay` the
  // hover affordance.
  function editZone(args: {
    kind: MediaKind
    hasImage: boolean
    anchor: ReturnType<typeof useClickAnchor>
    className: string
    overlay: React.ReactNode
    children: React.ReactNode
  }) {
    const surface = cn(
      "group focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
      args.className,
    )
    if (args.hasImage) {
      return (
        <DropdownMenu
          open={args.anchor.open}
          onOpenChange={args.anchor.onOpenChange}
        >
          <DropdownMenuTrigger
            disabled={uploading}
            className={surface}
            onPointerDown={args.anchor.onTriggerPointerDown}
          >
            {args.children}
            {args.overlay}
          </DropdownMenuTrigger>
          {mediaMenu(args.kind)}
        </DropdownMenu>
      )
    }
    return (
      <button
        type="button"
        disabled={uploading}
        onClick={() => openFilePicker(args.kind)}
        className={surface}
      >
        {args.children}
        {args.overlay}
      </button>
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
            {/* Live profile preview — a miniature of the real floating profile.
                Click the wallpaper, banner, or avatar to change or remove it. */}
            <div>
              <div className="text-foreground mb-1.5 text-sm font-medium">
                Profile preview
              </div>
              <p className="text-foreground-faint mb-2 text-xs">
                Click the wallpaper, banner, or avatar to change or remove it.
              </p>

              <form.Subscribe
                selector={(state) =>
                  [state.values.email, state.values.username] as const
                }
              >
                {([currentEmail, currentUsername]) => {
                  const normalizedIdentity = normalizeProfileIdentity({
                    email: currentEmail,
                    username: currentUsername,
                  })
                  const identityUser = {
                    id: userId,
                    username: normalizedIdentity.username || null,
                    email: normalizedIdentity.email || email,
                    image: profileImage || null,
                  }
                  const previewName = displayName(identityUser)
                  const avatar = userAvatar(identityUser)
                  const hasAvatar = !!avatar.src

                  return (
                    <div className="bg-surface-sunken ring-border/60 relative aspect-[16/9] overflow-hidden rounded-xl ring-1">
                      {/* Wallpaper (full bleed, clickable in the margins) */}
                      {editZone({
                        kind: "background",
                        hasImage: hasBackground,
                        anchor: backgroundAnchor,
                        className: "absolute inset-0 block",
                        overlay: CORNER_EDIT_OVERLAY,
                        children: hasBackground ? (
                          <img
                            src={backgroundSrc}
                            alt=""
                            aria-hidden
                            className="absolute inset-0 size-full object-cover"
                          />
                        ) : (
                          <span className="text-foreground-faint absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs">
                            <ImageIcon className="size-5" />
                            Wallpaper
                          </span>
                        ),
                      })}

                      {/* Floating card — centered with margins so the wallpaper
                          shows around it and stays clickable. The whole card is
                          a single frosted surface (banner + body share it) so
                          there's no seam between the two when no banner is set. */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                        <div className="bg-surface-sunken/55 ring-border/50 pointer-events-auto w-[86%] overflow-hidden rounded-lg shadow-[var(--shadow-md)] ring-1 backdrop-blur-2xl backdrop-saturate-150">
                          {editZone({
                            kind: "banner",
                            hasImage: hasBanner,
                            anchor: bannerAnchor,
                            className: cn(
                              "relative block w-full",
                              PROFILE_BANNER_ASPECT_CLASS,
                            ),
                            overlay: CENTER_EDIT_OVERLAY,
                            children: hasBanner ? (
                              <UserBanner user={bannerUser} />
                            ) : (
                              // Transparent so the card's single frost shows
                              // through — no second blurred layer, no seam.
                              <span className="text-foreground-faint absolute inset-0 flex items-center justify-center gap-1.5 text-xs">
                                <ImageIcon className="size-4" />
                                Add banner
                              </span>
                            ),
                          })}

                          <div className="relative flex items-center gap-2.5 px-3 pb-2.5">
                            {editZone({
                              kind: "avatar",
                              hasImage: hasAvatar,
                              anchor: avatarAnchor,
                              className:
                                "relative -mt-5 inline-flex size-12 shrink-0 overflow-hidden rounded-full ring-2 ring-white/10",
                              overlay: CENTER_EDIT_OVERLAY,
                              children: (
                                <ProfileAvatarPreview
                                  avatar={avatar}
                                  previewName={previewName}
                                  showImage={hasAvatar}
                                />
                              ),
                            })}
                            <div className="min-w-0 pt-1">
                              <div className="text-foreground truncate text-sm font-semibold">
                                {previewName}
                              </div>
                              <div className="text-foreground-faint truncate text-xs">
                                {normalizedIdentity.email || email}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </form.Subscribe>
            </div>

            {/* Profile accent */}
            <div>
              <div className="text-foreground mb-1.5 text-sm font-medium">
                Profile accent
              </div>
              <p className="text-foreground-faint mb-2 text-xs">
                Auto-derived from your wallpaper. Override it with any color.
              </p>
              <div className="flex items-center gap-2">
                <ColorPicker
                  value={profileAccent || DEFAULT_ACCENT}
                  onChange={handleAccentChange}
                  disabled={uploading}
                  aria-label="Profile accent color"
                />
                <span className="text-foreground-muted font-mono text-xs uppercase">
                  {(profileAccent || DEFAULT_ACCENT).toUpperCase()}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleAutoAccent()}
                    disabled={uploading || !hasBackground}
                  >
                    Auto
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleClearAccent()}
                    disabled={uploading || !profileAccent}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </div>

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
                  state.values.username,
                  state.values.email,
                  state.canSubmit,
                  state.isSubmitting,
                ] as const
              }
            >
              {([currentUsername, currentEmail, canSubmit, isSubmitting]) => {
                const dirty = profileIdentityChanged(
                  {
                    email: currentEmail,
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
