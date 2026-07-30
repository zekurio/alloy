import { t } from "@alloy/i18n"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react"

import { StorageQuotaCompact } from "@/components/storage-quota"
import { completeSignOutFlow, reportAuthFlowFailure } from "@/lib/auth-flow"
import { useOpenSettings } from "@/lib/use-open-settings"

export function AccountMenuItems({ handle }: { handle: string | null }) {
  const router = useRouter()
  const navigate = useNavigate()
  const openSettings = useOpenSettings()

  async function onSignOut() {
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

export function avatarTint(avatar: { bg?: string; fg?: string }) {
  return {
    background: avatar.bg ?? "var(--neutral-200)",
    color: avatar.fg ?? "var(--foreground)",
  }
}
