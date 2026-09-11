import { clipSourceFileUrl, type ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { useState } from "react"

import {
  DEFAULT_SCREENSHOT_EDIT,
  exportScreenshot,
} from "@/components/media/screenshot-edit"
import { ScreenshotEditor } from "@/components/media/screenshot-editor"
import { useUpdateClipImageMutation } from "@/lib/clip-queries"
import { apiOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"

export function LibraryScreenshotEditor({
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
  const mediaUrl = clipSourceFileUrl(
    row.id,
    apiOrigin(),
    row.sourceVersion ?? undefined,
  )
  const changed =
    JSON.stringify(edit) !== JSON.stringify(DEFAULT_SCREENSHOT_EDIT)
  const save = async () => {
    if (disabled || saving || !changed || !row.sourceVersion) return
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
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't save changes")))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="relative flex min-w-0 flex-col gap-3 lg:min-h-0">
      <ScreenshotEditor
        mediaUrl={mediaUrl}
        value={edit}
        onChange={setEdit}
        disabled={disabled || saving}
      />
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={disabled || saving || !changed}
          onClick={() => void save()}
        >
          {saving ? t("Saving…") : t("Save")}
        </Button>
      </div>
    </section>
  )
}
