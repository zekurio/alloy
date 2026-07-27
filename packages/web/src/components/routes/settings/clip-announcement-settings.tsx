import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import { useRequireAuthStrict } from "@/lib/auth-hooks"
import { errorMessage } from "@/lib/error-message"

/**
 * Author-side opt-out for instance webhooks. Applies immediately rather than
 * through the settings save bar, which exists for dirty-state text forms.
 */
export function ClipAnnouncementRow() {
  const session = useRequireAuthStrict()
  const [pending, setPending] = useState(false)
  const user = session?.user
  if (!user) return null

  async function change(next: boolean) {
    setPending(true)
    const { error } = await authClient.updateUser({
      clipAnnouncementsEnabled: next,
    })
    setPending(false)
    if (error) {
      toast.error(errorMessage(error, t("Couldn't save preference")))
      return
    }
    toast.success(next ? t("Announcements on") : t("Announcements off"))
  }

  return (
    <SettingRow
      title={t("Announce my clips")}
      description={t(
        "Let this server post your public clips to the webhooks it has configured.",
      )}
    >
      <Switch
        checked={user.clipAnnouncementsEnabled}
        disabled={pending}
        onCheckedChange={(next) => void change(next)}
      />
    </SettingRow>
  )
}
