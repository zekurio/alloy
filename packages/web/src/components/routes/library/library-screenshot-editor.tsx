import { clipSourceFileUrl, type ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import {
  DEFAULT_SCREENSHOT_EDIT,
  exportScreenshot,
  type ScreenshotEdit,
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
  const sourceVersion = row.sourceVersion
  // An edit belongs to the image it was made on; new source bytes start over.
  const [draft, setDraft] = useState({
    sourceVersion,
    edit: DEFAULT_SCREENSHOT_EDIT,
  })
  const edit =
    draft.sourceVersion === sourceVersion ? draft.edit : DEFAULT_SCREENSHOT_EDIT
  const setEdit = (next: ScreenshotEdit) =>
    setDraft({ sourceVersion, edit: next })
  const imageMutation = useUpdateClipImageMutation()
  const mediaUrl = clipSourceFileUrl(
    row.id,
    apiOrigin(),
    sourceVersion ?? undefined,
  )
  const saveMutation = useMutation({
    mutationFn: async (input: {
      edit: ScreenshotEdit
      sourceVersion: string
    }) => {
      const response = await fetch(mediaUrl)
      if (!response.ok) throw new Error(t("Couldn't open image"))
      const source = new File([await response.blob()], "screenshot.png", {
        type: "image/png",
      })
      const file = await exportScreenshot(source, input.edit)
      await imageMutation.mutateAsync({
        clipId: row.id,
        file,
        sourceVersion: input.sourceVersion,
      })
    },
  })
  const saving = saveMutation.isPending
  const error =
    saveMutation.error &&
    saveMutation.variables?.sourceVersion === sourceVersion
      ? errorMessage(saveMutation.error, t("Couldn't save changes"))
      : null
  const changed =
    JSON.stringify(edit) !== JSON.stringify(DEFAULT_SCREENSHOT_EDIT)
  const save = async () => {
    if (disabled || saving || !changed || !sourceVersion) return false
    try {
      await saveMutation.mutateAsync({ edit, sourceVersion })
      setEdit(DEFAULT_SCREENSHOT_EDIT)
      return true
    } catch {
      return false
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
