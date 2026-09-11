import { clipSourceFileUrl, type ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useEffect, useState } from "react"

import {
  DEFAULT_SCREENSHOT_EDIT,
  exportScreenshot,
} from "@/components/media/screenshot-edit"
import { ScreenshotEditor } from "@/components/media/screenshot-editor"
import { useUpdateClipImageMutation } from "@/lib/clip-queries"
import { apiOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"

export function useLibraryScreenshotEdit({
  row,
  disabled,
}: {
  row: ClipRow
  disabled: boolean
}) {
  const [edit, setEdit] = useState(DEFAULT_SCREENSHOT_EDIT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useUpdateClipImageMutation()
  useEffect(() => {
    setEdit(DEFAULT_SCREENSHOT_EDIT)
    setError(null)
  }, [row.id, row.sourceVersion])
  const mediaUrl = clipSourceFileUrl(
    row.id,
    apiOrigin(),
    row.sourceVersion ?? undefined,
  )
  const changed =
    JSON.stringify(edit) !== JSON.stringify(DEFAULT_SCREENSHOT_EDIT)
  const save = async () => {
    if (disabled || saving || !changed || !row.sourceVersion) return false
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(mediaUrl)
      if (!response.ok) throw new Error(t("Couldn't open image"))
      const source = new File([await response.blob()], "screenshot.png", {
        type: "image/png",
      })
      const file = await exportScreenshot(source, edit)
      await mutation.mutateAsync({
        clipId: row.id,
        file,
        sourceVersion: row.sourceVersion,
      })
      setEdit(DEFAULT_SCREENSHOT_EDIT)
      return true
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't save changes")))
      return false
    } finally {
      setSaving(false)
    }
  }
  return { edit, setEdit, mediaUrl, changed, saving, error, save }
}

export function LibraryScreenshotEditor({
  state,
  disabled,
}: {
  state: ReturnType<typeof useLibraryScreenshotEdit>
  disabled: boolean
}) {
  return (
    <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
      <ScreenshotEditor
        mediaUrl={state.mediaUrl}
        value={state.edit}
        onChange={state.setEdit}
        disabled={disabled || state.saving}
      />
    </section>
  )
}
