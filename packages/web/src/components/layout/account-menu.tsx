import { t } from "@alloy/i18n"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useOpenSettings } from "@/lib/use-open-settings"

function useSignOut() {
  const router = useRouter()
  const navigate = useNavigate()

  return async function onSignOut() {
    try {
      await completeSignOutFlow({
        invalidateRouter: () => router.invalidate(),
        navigate: () => navigate({ to: "/login", replace: true }),
      })
    } catch (cause) {
      toast.error(
        reportAuthFlowFailure("sign-out", t("Couldn't sign out"), cause),
      )
    }
  }
}

export function AccountMenuItems({ handle }: { handle: string | null }) {
  const openSettings = useOpenSettings()
  const onSignOut = useSignOut()

  return (
    <>
      {handle ? (
        <DropdownMenuItem
          render={<Link to="/u/$username" params={{ username: handle }} />}
        >
          <UserIcon />
          {t("Profile")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={openSettings}>
        <SettingsIcon />
        {t("Settings")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <div className="px-3 py-2">
        <StorageQuotaCompact />
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={onSignOut}>
        <LogOutIcon />
        {t("Sign out")}
      </DropdownMenuItem>
    </>
  )
}

/** The phone's account sheet: the same entries as full-width touch rows. */
export function AccountSheetItems({
  handle,
  onClose,
}: {
  handle: string | null
  onClose: () => void
}) {
  const openSettings = useOpenSettings()
  const onSignOut = useSignOut()

  return (
    <>
      {handle ? (
        <Link
          to="/u/$username"
          params={{ username: handle }}
          className={sheetRowClass}
          onClick={onClose}
        >
          <UserIcon />
          {t("Profile")}
        </Link>
      ) : null}
      <button
        type="button"
        className={sheetRowClass}
        onClick={() => {
          onClose()
          openSettings()
        }}
      >
        <SettingsIcon />
        {t("Settings")}
      </button>
      <div className="border-border my-2 border-t" />
      <StorageQuotaCompact className="px-3 py-2" />
      <div className="border-border my-2 border-t" />
      <button
        type="button"
        className={cn(sheetRowClass, "text-danger [&>svg]:text-danger")}
        onClick={() => {
          onClose()
          void onSignOut()
        }}
      >
        <LogOutIcon />
        {t("Sign out")}
      </button>
    </>
  )
}

const sheetRowClass = cn(
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-md font-medium outline-none",
  "hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring",
  "[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-foreground-dim",
)

export function avatarTint(avatar: { bg: string; fg: string }) {
  return { background: avatar.bg, color: avatar.fg }
}
