import type { PublicUser } from "@alloy/api"
import { cn } from "@alloy/ui/lib/utils"

import { PROFILE_BANNER_ASPECT_CLASS } from "@/lib/banner-layout"
import { UserBanner } from "@/lib/user-display"

/**
 * The banner strip at the top of the floating profile card, locked to a fixed
 * aspect ratio so it always matches the crop boundary. Only rendered when the
 * user actually has a banner — without one the card has no banner section and
 * its content body becomes the rounded top instead.
 *
 * The parent card owns the rounded corners (via `overflow-hidden`), so this
 * just fills the top edge; a soft bottom fade eases the banner into the frosted
 * content body below.
 */
export function ProfileBanner({ user }: { user: PublicUser }) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        PROFILE_BANNER_ASPECT_CLASS,
      )}
    >
      <UserBanner user={user} />
      <div className="to-surface-sunken/40 absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent" />
    </div>
  )
}
