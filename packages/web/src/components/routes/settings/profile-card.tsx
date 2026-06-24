import { t } from "@alloy/i18n"
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
import { useForm, useStore } from "@tanstack/react-form"
import { ImageIcon, Pencil, SaveIcon } from "lucide-react"
import { useEffect } from "react"
import type { ReactNode } from "react"

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
import { useSettingsSaveBar } from "./settings-save-context"
import { useProfileMedia } from "./use-profile-media"

type ProfileCardProps = {
  userId: string
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
  description?: ReactNode
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
    // Fills the sized wrapper button so the preview avatar tracks the
    // responsive size-16/size-24 zone; the `2xl` token supplies the initials
    // text size.
    <Avatar size="2xl" style={style} className="!size-full">
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

export function ProfileCard({
  userId,
  initialUsername,
  image,
  banner,
  email,
}: ProfileCardProps) {
  const media = useProfileMedia({ image, banner })
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
          toast.error(errorMessage(error, t("Couldn't save")))
          return
        }

        toast.success(t("Saved"))
        await media.refreshProfile()
      } catch (cause) {
        toast.error(errorMessage(cause, t("Something went wrong")))
      }
    },
  })

  useEffect(() => {
    form.reset({
      email,
      username: initialUsername,
    })
  }, [email, form, initialUsername])

  // Media (avatar, banner) applies as soon as it uploads; only the identity
  // fields go through the dialog's unified save bar.
  const identityDirty = useStore(form.store, (state) =>
    profileIdentityChanged(state.values, initialIdentity),
  )
  const identitySaving = useStore(form.store, (state) => state.isSubmitting)
  const inSettingsDialog = useSettingsSaveBar({
    dirty: identityDirty,
    saving: identitySaving,
    save: () => form.handleSubmit(),
    discard: () => form.reset(),
  })

  // A clickable region in the live profile preview. When the element already
  // has an image, clicking opens the change/remove menu; otherwise it opens the
  // file picker directly. `children` is the rendered element, `overlay` the
  // hover affordance.
  function editZone(args: {
    kind: MediaKind
    hasImage: boolean
    anchor: ReturnType<typeof useClickAnchor>
    className: string
    overlay: ReactNode
    children: ReactNode
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
      label: t("Username"),
      name: "username",
      type: "text",
      validate: validateUsername,
    },
    {
      autoComplete: "email",
      label: t("Email"),
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
          <SectionContent className="flex flex-col gap-3.5 py-0">
            {/* Live profile preview — a miniature of the real profile header.
                Click the banner or avatar to change or remove it. */}
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="text-foreground text-sm font-medium">
                  {t("Profile preview")}
                </div>
                <p className="text-foreground-faint hidden text-xs sm:block">
                  {t("Click media to edit.")}
                </p>
              </div>

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
                    <div className="bg-surface-sunken ring-border/60 relative overflow-hidden rounded-lg ring-1">
                      {/* Full-width banner */}
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
                          // Fades out on hover so it doesn't collide with the
                          // centered pencil affordance.
                          <span className="text-foreground-faint absolute inset-0 flex items-center justify-center gap-1.5 text-xs opacity-100 transition-opacity group-hover:opacity-0">
                            <ImageIcon className="size-4" />
                            {t("Add banner")}
                          </span>
                        ),
                      })}

                      {/* Identity bar — avatar straddles the banner seam above */}
                      <div className="relative flex items-end gap-3 px-3 pb-3 sm:gap-4 sm:px-4">
                        {editZone({
                          kind: "avatar",
                          hasImage: hasAvatar,
                          anchor: media.avatarAnchor,
                          className:
                            "ring-background relative -mt-8 inline-flex size-16 shrink-0 overflow-hidden rounded-full ring-[3px] sm:-mt-12 sm:size-24 sm:ring-4",
                          overlay: CENTER_EDIT_OVERLAY,
                          children: (
                            <ProfileAvatarPreview
                              avatar={avatar}
                              previewName={previewName}
                              showImage={hasAvatar}
                            />
                          ),
                        })}
                        <div className="min-w-0 flex-1 pb-0.5">
                          <div className="text-foreground truncate text-sm font-semibold sm:text-base">
                            {previewName}
                          </div>
                          <div className="text-foreground-faint truncate text-xs">
                            {normalizedIdentity.email || email}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </form.Subscribe>
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

          {!inSettingsDialog && (
            <SectionFooter>
              <form.Subscribe
                selector={(state) =>
                  [state.canSubmit, state.isSubmitting] as const
                }
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!identityDirty || !canSubmit}
                  >
                    <SaveIcon />
                    {isSubmitting ? t("Saving…") : t("Save")}
                  </Button>
                )}
              </form.Subscribe>
            </SectionFooter>
          )}
        </Section>
      </form>
    </>
  )
}
