import type { ClipPrivacy } from "@alloy/api"
import { clipShareUrl } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { useCallback } from "react"

import { shareUrlWithFallback } from "@/lib/browser-share"
import { publicOrigin } from "@/lib/env"
import { useActionFeedback } from "@/lib/use-action-feedback"

/** Shares the clip's public link, or copies it where sharing is unavailable. */
export function useClipShare({
  clipId,
  title,
  privacy,
}: {
  clipId: string
  title: string
  privacy: ClipPrivacy
}) {
  const { feedback, run } = useActionFeedback()

  const share = useCallback(async () => {
    await run(async () => {
      if (privacy === "private") throw new Error(t("Clip link is disabled"))
      const url = clipShareUrl(clipId, publicOrigin())
      const result = await shareUrlWithFallback(url, {
        title,
        action: "share clip link",
      })
      if (result === "failed") throw new Error(t("Couldn't share clip"))
      return result !== "cancelled"
    }, t("Couldn't share clip"))
  }, [clipId, privacy, run, title])

  return { feedback, share }
}
