import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useForm } from "@tanstack/react-form"
import { ImageIcon, Pencil, SaveIcon } from "lucide-react"
import * as React from "react"

import { ColorPicker } from "@/components/form/color-picker"
import type { useClickAnchor } from "@/hooks/use-click-anchor"
import { authClient } from "@/lib/auth-client"
import { PROFILE_BANNER_ASPECT_CLASS } from "@/lib/banner-layout"
import { errorMessage } from "@/lib/error-message"
import { validateEmail, validateUsername } from "@/lib/form-validators"
import {
  normalizeProfileIdentity,
  profileIdentityChanged,
  profileIdentityPatch,
} from "@/lib/profile-identity"
import { displayName, userAvatar, UserBanner } from "@/lib/user-display"

import { ProfileImageCropDialog } from "./profile-image-crop-dialog"
import { MediaEditOverlay, type MediaKind } from "./profile-media-controls"
import { ProfileTextField } from "./profile-text-field"
import { useProfileMedia } from "./use-profile-media"

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

export function ProfileCard({
  userId,
  initialUsername,
  image,
  banner,
  background,
  accentColor,
  email,
}: ProfileCardProps) {
  const media = useProfileMedia({ image, banner, background, accentColor })
  const bannerUser = {
    id: userId,
    image: media.profileImage || null,
    banner: media.profileBanner || null,
  }
  const initialIdentity = {
    email,
    username: initialUsername,
  }
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
        await media.refreshProfile()
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
            disabled={media.uploading}
            className={surface}
            onPointerDown={args.anchor.onTriggerPointerDown}
          >
            {args.children}
            {args.overlay}
          </DropdownMenuTrigger>
          {media.mediaMenu(args.kind)}
        </DropdownMenu>
      )
    }
    return (
      <button
        type="button"
        disabled={media.uploading}
        onClick={() => media.openFilePicker(args.kind)}
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
      {media.fileInputs}
      <ProfileImageCropDialog
        file={media.cropFile}
        mode={media.cropMode}
        open={!!media.cropFile}
        applying={media.uploading}
        onApplyingChange={media.setCropApplying}
        onOpenChange={(open) => {
          if (!open && !media.uploading && !media.cropApplying) {
            media.setCropFile(null)
          }
        }}
        onApply={async (blob) => {
          const uploaded = await media.handleImageUpload(blob, media.cropMode)
          if (uploaded) {
            media.setCropFile(null)
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
                    image: media.profileImage || null,
                  }
                  const previewName = displayName(identityUser)
                  const avatar = userAvatar(identityUser)
                  const hasAvatar = !!avatar.src

                  return (
                    <div className="bg-surface-sunken ring-border/60 relative aspect-[16/9] overflow-hidden rounded-xl ring-1">
                      {/* Wallpaper (full bleed, clickable in the margins) */}
                      {editZone({
                        kind: "background",
                        hasImage: media.hasBackground,
                        anchor: media.backgroundAnchor,
                        className: "absolute inset-0 block",
                        overlay: CORNER_EDIT_OVERLAY,
                        children: media.hasBackground ? (
                          <img
                            src={media.backgroundSrc}
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
                            hasImage: media.hasBanner,
                            anchor: media.bannerAnchor,
                            className: cn(
                              "relative block w-full",
                              PROFILE_BANNER_ASPECT_CLASS,
                            ),
                            overlay: CENTER_EDIT_OVERLAY,
                            children: media.hasBanner ? (
                              <UserBanner user={bannerUser} />
                            ) : (
                              // Transparent so the card's single frost shows
                              // through — no second blurred layer, no seam.
                              // Fades out on hover so it doesn't collide with
                              // the centered pencil affordance.
                              <span className="text-foreground-faint absolute inset-0 flex items-center justify-center gap-1.5 text-xs opacity-100 transition-opacity group-hover:opacity-0">
                                <ImageIcon className="size-4" />
                                Add banner
                              </span>
                            ),
                          })}

                          <div className="relative flex items-center gap-2.5 px-3 pb-2.5">
                            {editZone({
                              kind: "avatar",
                              hasImage: hasAvatar,
                              anchor: media.avatarAnchor,
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
                  value={media.profileAccent || DEFAULT_ACCENT}
                  onChange={media.handleAccentChange}
                  disabled={media.uploading}
                  aria-label="Profile accent color"
                />
                <span className="text-foreground-muted font-mono text-xs uppercase">
                  {(media.profileAccent || DEFAULT_ACCENT).toUpperCase()}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void media.handleAutoAccent()}
                    disabled={media.uploading || !media.hasBackground}
                  >
                    Auto
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void media.handleClearAccent()}
                    disabled={media.uploading || !media.profileAccent}
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
