import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Loader2Icon, UploadIcon } from "lucide-react"
import { Suspense, lazy, useRef } from "react"

import { alloyDesktop } from "@/lib/desktop"

import { useImportClipAction } from "./import-clip-action"
import { ACCEPT_LIST } from "./new-clip-helpers"
import { useWebUploadAction } from "./web-upload-action"

const loadImportClipDialog = async () => {
  // Static import would pull this dialog into the eager header chunk.
  const module = await import("./import-clip-dialog")
  return { default: module.ImportClipDetailsDialog }
}

const loadWebUploadEditor = async () => {
  // Static import would pull the editor surface into the eager header chunk.
  const module = await import("./web-upload-editor")
  return { default: module.WebUploadEditor }
}

const ImportClipDetailsDialog = lazy(loadImportClipDialog)
const WebUploadEditor = lazy(loadWebUploadEditor)

/**
 * Global "Upload" entry point, mounted once in the header so a clip can be
 * started from any route instead of only from the library page. Branches on
 * the desktop shell: the desktop app imports an already-recorded file via
 * the sidecar's staged-import flow, the browser picks a file and opens the
 * trim/metadata editor. Both flows render their own dialog, so this stays a
 * single always-present trigger regardless of which one fires.
 */
export function GlobalUploadControl() {
  const desktop = alloyDesktop()
  const importAction = useImportClipAction(desktop)
  const webUploadAction = useWebUploadAction()
  const inputRef = useRef<HTMLInputElement>(null)

  if (desktop) {
    const pending = importAction.picking || importAction.committing
    return (
      <>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!importAction.available || pending}
          title={
            importAction.available
              ? t("Upload clip")
              : t("Import is unavailable in this desktop build")
          }
          onClick={() => {
            // Warm the chunk; lazy() re-fetches on mount if this fails.
            void loadImportClipDialog().catch(() => {})
            void importAction.start()
          }}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          <span className="max-md:hidden">{t("Upload")}</span>
        </Button>
        {importAction.staged !== null ? (
          <Suspense fallback={null}>
            <ImportClipDetailsDialog action={importAction} />
          </Suspense>
        ) : null}
      </>
    )
  }

  const pending = webUploadAction.picking || webUploadAction.publishing
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_LIST}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ""
          void webUploadAction.select(file)
        }}
      />
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={
          !webUploadAction.available ||
          pending ||
          webUploadAction.selected !== null
        }
        title={
          webUploadAction.available
            ? t("Upload clip")
            : t("Uploads are unavailable in this browser")
        }
        onClick={() => {
          // Warm the chunk; lazy() re-fetches on mount if this fails.
          void loadWebUploadEditor().catch(() => {})
          inputRef.current?.click()
        }}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        <span className="max-md:hidden">{t("Upload")}</span>
      </Button>
      {webUploadAction.selected !== null ? (
        <Suspense fallback={null}>
          <WebUploadEditor action={webUploadAction} />
        </Suspense>
      ) : null}
    </>
  )
}
