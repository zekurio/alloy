import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useEffect, useState } from "react"

import { authClient, useSession } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"

const CLIP_ANNOUNCEMENTS_ID = "clip-announcements-enabled"

/**
 * Author-side opt-out for instance webhooks. Applies immediately rather than
 * through the settings save bar, which exists for dirty-state text forms.
 */
export function ClipAnnouncementRow() {
  const { data: session } = useSession()
  const [pending, setPending] = useState(false)
  const user = session?.user
  const [enabled, setEnabled] = useState(
    user?.clipAnnouncementsEnabled ?? false,
  )

  useEffect(() => {
    if (user) setEnabled(user.clipAnnouncementsEnabled)
  }, [user])

  if (!user) return null

  async function change(next: boolean) {
    const previous = enabled
    setEnabled(next)
    setPending(true)
    try {
      const { error } = await authClient.updateUser({
        clipAnnouncementsEnabled: next,
      })
      if (error) {
        setEnabled(previous)
        toast.error(errorMessage(error, t("Couldn't save preference")))
        return
      }
      toast.success(next ? t("Announcements on") : t("Announcements off"))
    } catch (cause) {
      setEnabled(previous)
      toast.error(errorMessage(cause, t("Couldn't save preference")))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingRow
      title={t("Announce my clips")}
      htmlFor={CLIP_ANNOUNCEMENTS_ID}
      description={t(
        "Let this server post your public clips to the webhooks it has configured.",
      )}
    >
      <Switch
        id={CLIP_ANNOUNCEMENTS_ID}
        checked={enabled}
        disabled={pending}
        onCheckedChange={(next) => void change(next)}
      />
    </SettingRow>
  )
}
