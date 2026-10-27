import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { useMutation } from "@tanstack/react-query"

import { authClient, useSession } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"

const CLIP_ANNOUNCEMENTS_ID = "clip-announcements-enabled"

/**
 * Author-side opt-out for instance webhooks. Applies immediately rather than
 * through the settings save bar, which exists for dirty-state text forms.
 */
export function ClipAnnouncementRow() {
  const { data: session } = useSession()
  const preference = useMutation({
    mutationFn: async (next: boolean) => {
      // updateUser applies the saved user to the session itself and reports
      // failures through `error`; a rejection also means nothing was saved.
      const { error } = await authClient.updateUser({
        clipAnnouncementsEnabled: next,
      })
      if (error)
        throw new Error(errorMessage(error, t("Couldn't save preference")))
    },
  })
  const user = session?.user
  if (!user) return null

  // Show the requested value while it saves, so a concurrent session
  // revalidation delivering the stale value can't revert the toggle; a
  // failure falls back to the session value.
  const enabled = preference.isPending
    ? preference.variables
    : user.clipAnnouncementsEnabled
  const saveError = preference.error
    ? errorMessage(preference.error, t("Couldn't save preference"))
    : null

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
        disabled={preference.isPending}
        onCheckedChange={(next) => preference.mutate(next)}
      />
    </SettingRow>
  )
}
