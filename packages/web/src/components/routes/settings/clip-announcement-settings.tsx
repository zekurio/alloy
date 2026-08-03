import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const user = session?.user
  const [enabled, setEnabled] = useState(
    user?.clipAnnouncementsEnabled ?? false,
  )

  // Skip the mirror while a save is in flight so a concurrent session
  // revalidation delivering the stale value can't revert the optimistic
  // toggle; when pending clears, the effect re-runs and syncs to the
  // authoritative session value.
  useEffect(() => {
    if (!user || pending) return
    setEnabled(user.clipAnnouncementsEnabled)
  }, [user, pending])

  if (!user) return null

  function change(next: boolean) {
    const previous = enabled
    setSaveError(null)
    setEnabled(next)
    setPending(true)
    void authClient
      .updateUser({ clipAnnouncementsEnabled: next })
      .then(({ error }) => {
        if (error) {
          setEnabled(previous)
          setSaveError(errorMessage(error, t("Couldn't save preference")))
          return
        }
      })
      // updateUser only rejects when the session refetch after a successful
      // save fails; the store still holds the stale value then, so revert to
      // stay consistent with it.
      .catch((cause) => {
        setEnabled(previous)
        setSaveError(errorMessage(cause, t("Couldn't save preference")))
      })
      .finally(() => setPending(false))
  }

  return (
    <SettingRow
      title={t("Announce my clips")}
      htmlFor={CLIP_ANNOUNCEMENTS_ID}
      description={
        <>
          {t(
            "Let this server post your public clips to the webhooks it has configured.",
          )}
          {saveError ? (
            <span role="alert" className="text-destructive mt-1 block">
              {saveError}
            </span>
          ) : null}
        </>
      }
    >
      <Switch
        id={CLIP_ANNOUNCEMENTS_ID}
        checked={enabled}
        disabled={pending}
        onCheckedChange={change}
      />
    </SettingRow>
  )
}
