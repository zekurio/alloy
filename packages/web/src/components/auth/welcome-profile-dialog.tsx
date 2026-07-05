import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon, Pencil } from "lucide-react"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"

import { ImageCropDialog } from "@/components/media/image-crop-dialog"
import { MediaEditOverlay } from "@/components/routes/settings/profile-media-controls"
import { useProfileMedia } from "@/components/routes/settings/use-profile-media"
import { PROFILE_BANNER_ASPECT_CLASS } from "@/lib/banner-layout"
import {
  useSuspenseAuthConfig,
  useSuspenseSession,
} from "@/lib/session-suspense"
import { displayName, userAvatar, userImageSrc } from "@/lib/user-display"

type WelcomeProfileDialogProps = {
  welcome: string | null
  onClose: () => void
}

export function WelcomeProfileDialog({
  welcome,
  onClose,
}: WelcomeProfileDialogProps) {
  // Keep the last non-null value mounted so the dialog can animate out after
  // the URL param clears, mirroring SettingsDialog's visibleSection pattern.
  const [visibleWelcome, setVisibleWelcome] = useState(welcome)
  useEffect(() => {
    if (welcome !== null) setVisibleWelcome(welcome)
  }, [welcome])

  const activeWelcome = welcome ?? visibleWelcome
  if (activeWelcome === null) return null
  return (
    <WelcomeProfileDialogContent
      welcome={activeWelcome}
      open={welcome !== null}
      onClose={onClose}
    />
  )
}

function WelcomeProfileDialogContent({
  welcome,
  open,
  onClose,
}: {
  welcome: string
  open: boolean
  onClose: () => void
}) {
  const session = useSuspenseSession()
  const config = useSuspenseAuthConfig()
  const user = session?.user
  const media = useProfileMedia({
    image: user?.image ?? "",
    banner: user?.banner ?? "",
  })
  // Snapshot of the avatar at first render: the provenance caption must only
  // describe the synced provider avatar, never one the user picked here.
  const [initialImage] = useState(() => user?.image ?? "")
  const providerName =
    welcome === "1"
      ? null
      : config.providers.find((provider) => provider.providerId === welcome)
          ?.displayName

  if (!user) return null

  const avatar = userAvatar({ ...user, image: media.profileImage || null })
  const avatarStyle = { background: avatar.bg, color: avatar.fg }
  const bannerSrc = userImageSrc(media.profileBanner)
  const previewName = displayName(user)
  const syncedAvatarShown =
    welcome !== "1" &&
    initialImage !== "" &&
    media.profileImage === initialImage
  const providerCaption = !syncedAvatarShown
    ? null
    : providerName
      ? t("Avatar imported from {provider}", { provider: providerName })
      : t("Avatar imported from your sign-in provider")
  return (
    <>
      {media.fileInputs}
      <ImageCropDialog
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
        onApply={async ({ blob }) => {
          const uploaded = await media.handleImageUpload(blob, media.cropMode)
          if (uploaded) {
            media.setCropFile(null)
          }
        }}
      />
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent variant="secondary" className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("Set up your profile")}</DialogTitle>
            <DialogDescription>
              {t("Add an avatar and banner so people recognize you.")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <div className="bg-surface-sunken ring-border/60 overflow-hidden rounded-xl ring-1">
              <ProfileMediaButton
                ariaLabel={t("Add or replace banner")}
                disabled={media.uploading}
                className={cn(
                  "relative block w-full overflow-hidden",
                  PROFILE_BANNER_ASPECT_CLASS,
                )}
                onClick={() => media.openFilePicker("banner")}
              >
                {bannerSrc ? (
                  <img
                    src={bannerSrc}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="text-foreground-faint absolute inset-0 flex items-center justify-center gap-2 text-sm opacity-100 transition-opacity group-hover:opacity-0">
                    <ImageIcon className="size-4" />
                    {t("Add banner")}
                  </span>
                )}
                <MediaEditOverlay>
                  <Pencil className="size-4 text-white" />
                </MediaEditOverlay>
              </ProfileMediaButton>

              <div className="relative flex items-end gap-3 px-4 pb-4">
                <ProfileMediaButton
                  ariaLabel={t("Add or replace avatar")}
                  disabled={media.uploading}
                  className="ring-background relative -mt-10 inline-flex size-20 shrink-0 overflow-hidden rounded-full ring-4"
                  onClick={() => media.openFilePicker("avatar")}
                >
                  <Avatar size="2xl" style={avatarStyle} className="!size-full">
                    {avatar.src ? (
                      <AvatarImage src={avatar.src} alt={previewName} />
                    ) : null}
                    <AvatarFallback style={avatarStyle}>
                      {avatar.initials}
                    </AvatarFallback>
                  </Avatar>
                  <MediaEditOverlay>
                    <Pencil className="size-4 text-white" />
                  </MediaEditOverlay>
                </ProfileMediaButton>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="text-foreground truncate text-base font-semibold">
                    {previewName}
                  </div>
                  {providerCaption ? (
                    <p className="text-foreground-faint mt-1 text-sm">
                      {providerCaption}
                    </p>
                  ) : (
                    <p className="text-foreground-faint mt-1 text-sm">
                      {t("Click the avatar or banner to add media.")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose} disabled={media.uploading}>
              {t("Done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProfileMediaButton({
  ariaLabel,
  className,
  children,
  disabled,
  onClick,
}: {
  ariaLabel: string
  className: string
  children: ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "group focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
    >
      {children}
    </button>
  )
}
