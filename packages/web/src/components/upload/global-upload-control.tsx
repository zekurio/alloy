import { t } from "@alloy/i18n"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import { Loader2Icon, PlusIcon, UploadIcon } from "lucide-react"
import { Suspense, lazy, useRef } from "react"

import { alloyDesktop } from "@/lib/desktop"

import { useImportClipAction } from "./import-clip-action"
import { ACCEPT_LIST } from "./new-clip-helpers"
import { useWebUploadActionContext } from "./upload-flow-context"

const loadImportClipDialog = async () => {
  // Static import would pull this dialog into the eager header chunk.
  const module = await import("./import-clip-dialog")
  return { default: module.ImportClipDetailsDialog }
}

const ImportClipDetailsDialog = lazy(loadImportClipDialog)

type GlobalUploadControlVariant =
  | "header"
  | "floating"
  | "bottom-nav"
  | "center"

/**
 * Global "Upload" entry point, mounted wherever the app exposes the upload
 * affordance. Branches on the desktop shell: the desktop app imports an
 * already-recorded file via the sidecar's staged-import flow, the browser
 * picks a file and hands it to the shared full-screen library editor flow.
 * Browser selection state lives above every trigger so the initiating button
 * can unmount while the editor is open without discarding the selected file.
 */
export function GlobalUploadControl({
  variant = "header",
}: {
  variant?: GlobalUploadControlVariant
}) {
  const desktop = alloyDesktop()
  const importAction = useImportClipAction(desktop)
  const webUploadAction = useWebUploadActionContext()
  const inputRef = useRef<HTMLInputElement>(null)

  const triggerSize =
    variant === "header" || variant === "center" ? "sm" : "icon"
  const triggerClassName =
    variant === "header"
      ? "max-md:hidden"
      : variant === "center"
        ? "shrink-0"
        : variant === "floating"
          ? "!size-12 rounded-full px-0 shadow-lg"
          : "size-11 rounded-full px-0"
  const triggerLabel = t("Upload clip")
  const triggerAriaLabel = variant === "header" ? undefined : triggerLabel

  if (desktop) {
    const pending = importAction.picking || importAction.committing
    return (
      <>
        <FeedbackButton
          type="button"
          variant="primary"
          size={triggerSize}
          disabled={!importAction.available || pending}
          state={pending ? "pending" : importAction.error ? "error" : "idle"}
          pendingLabel={variant === "header" ? t("Working…") : null}
          errorLabel={variant === "header" ? t("Try again") : null}
          className={triggerClassName}
          aria-label={triggerAriaLabel}
          title={
            importAction.error ??
            (variant !== "header" || importAction.available
              ? triggerLabel
              : t("Import is unavailable in this desktop build"))
          }
          onClick={() => {
            // Warm the chunk; lazy() re-fetches on mount if this fails.
            void loadImportClipDialog().catch(() => {})
            void importAction.start()
          }}
        >
          <UploadTriggerContent pending={pending} variant={variant} />
        </FeedbackButton>
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
      <FeedbackButton
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
        state={pending ? "pending" : webUploadAction.error ? "error" : "idle"}
        pendingLabel={variant === "header" ? t("Working…") : null}
        errorLabel={variant === "header" ? t("Try again") : null}
        title={
          webUploadAction.error ??
          (variant !== "header" || webUploadAction.available
            ? triggerLabel
            : t("Uploads are unavailable in this browser"))
        }
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        <UploadTriggerContent pending={pending} variant={variant} />
      </FeedbackButton>
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
  const iconClass =
    variant === "bottom-nav"
      ? "size-[22px]"
      : variant === "floating"
        ? "!size-[22px]"
        : undefined
  const TriggerIcon =
    variant === "header" || variant === "center" ? UploadIcon : PlusIcon
  return (
    <>
      {pending ? (
        <Loader2Icon className={cn("animate-spin", iconClass)} />
      ) : (
        <TriggerIcon className={iconClass} />
      )}
      {variant === "header" || variant === "center" ? (
        <span>{t("Upload")}</span>
      ) : null}
    </>
  )
}
