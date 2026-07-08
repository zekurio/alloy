import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
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

type GlobalUploadControlVariant = "header" | "bottom-nav"

/**
 * Global "Upload" entry point, mounted wherever the app exposes the upload
 * affordance. Branches on the desktop shell: the desktop app imports an
 * already-recorded file via the sidecar's staged-import flow, the browser
 * picks a file and opens the trim/metadata editor. Each mount owns its own
 * state and dialog surface so header and bottom-nav instances remain
 * independent.
 */
export function GlobalUploadControl({
  variant = "header",
}: {
  variant?: GlobalUploadControlVariant
}) {
  const desktop = alloyDesktop()
  const importAction = useImportClipAction(desktop)
  const webUploadAction = useWebUploadAction()
  const inputRef = useRef<HTMLInputElement>(null)

  const triggerSize = variant === "header" ? "sm" : "icon"
  const triggerClassName =
    variant === "header" ? "max-md:hidden" : "size-11 rounded-full px-0"
  const triggerLabel = t("Upload clip")
  const triggerAriaLabel = variant === "bottom-nav" ? triggerLabel : undefined

  if (desktop) {
    const pending = importAction.picking || importAction.committing
    return (
      <>
        <Button
          type="button"
          variant="primary"
          size={triggerSize}
          disabled={!importAction.available || pending}
          className={triggerClassName}
          aria-label={triggerAriaLabel}
          title={
            variant === "bottom-nav" || importAction.available
              ? triggerLabel
              : t("Import is unavailable in this desktop build")
          }
          onClick={() => {
            // Warm the chunk; lazy() re-fetches on mount if this fails.
            void loadImportClipDialog().catch(() => {})
            void importAction.start()
          }}
        >
          <UploadTriggerContent pending={pending} variant={variant} />
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
        size={triggerSize}
        className={triggerClassName}
        aria-label={triggerAriaLabel}
        disabled={
          !webUploadAction.available ||
          pending ||
          webUploadAction.selected !== null
        }
        title={
          variant === "bottom-nav" || webUploadAction.available
            ? triggerLabel
            : t("Uploads are unavailable in this browser")
        }
        onClick={() => {
          // Warm the chunk; lazy() re-fetches on mount if this fails.
          void loadWebUploadEditor().catch(() => {})
          inputRef.current?.click()
        }}
      >
        <UploadTriggerContent pending={pending} variant={variant} />
      </Button>
      {webUploadAction.selected !== null ? (
        <Suspense fallback={null}>
          <WebUploadEditor action={webUploadAction} />
        </Suspense>
      ) : null}
    </>
  )
}

function UploadTriggerContent({
  pending,
  variant,
}: {
  pending: boolean
  variant: GlobalUploadControlVariant
}) {
  // Match the 22px glyphs of the neighboring bottom-nav tabs; the explicit
  // size- class opts out of Button's default svg sizing.
  const iconClass = variant === "bottom-nav" ? "size-[22px]" : undefined
  return (
    <>
      {pending ? (
        <Loader2Icon className={cn("animate-spin", iconClass)} />
      ) : (
        <UploadIcon className={iconClass} />
      )}
      {variant === "header" ? <span>{t("Upload")}</span> : null}
    </>
  )
}
