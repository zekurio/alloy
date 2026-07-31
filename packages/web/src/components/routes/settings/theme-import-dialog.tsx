import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { parseThemeMetadata } from "@alloy/ui/lib/custom-theme"

/**
 * Shows an imported file before it replaces what you have. Fluxer's one real
 * guard against pasting a stranger's theme blind, and the only chance to read
 * the CSS while the current theme is still intact.
 */
export function ThemeImportDialog({
  css,
  onOpenChange,
  onApply,
}: {
  /** The pending file's contents; null keeps the dialog closed. */
  css: string | null
  onOpenChange: (open: boolean) => void
  onApply: (css: string) => void
}) {
  const metadata = css === null ? null : parseThemeMetadata(css)

  return (
    <Dialog open={css !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{metadata?.name ?? t("Import theme")}</DialogTitle>
          <DialogDescription>
            {[
              metadata?.author && t("by {author}", { author: metadata.author }),
              metadata?.description,
            ]
              .filter(Boolean)
              .join(" — ") ||
              t(
                "This replaces your current custom CSS. You can edit it afterwards.",
              )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <pre className="border-border bg-surface-sunken max-h-80 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
            {css}
          </pre>
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={<Button variant="ghost">{t("Cancel")}</Button>}
          />
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              if (css !== null) onApply(css)
            }}
          >
            {t("Apply theme")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
