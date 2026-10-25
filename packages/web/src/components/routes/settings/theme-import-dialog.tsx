import { t, tp } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@alloy/ui/components/responsive-dialog"
import { Textarea } from "@alloy/ui/components/textarea"
import {
  getThemeState,
  saveCustomTheme,
  selectThemeFamily,
} from "@alloy/ui/lib/theme"
import {
  importThemeSources,
  newCustomThemeId,
  uniqueThemeName,
  type ThemeSource,
} from "@alloy/ui/lib/theme-custom"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { CircleAlertIcon, FileUpIcon, PlusIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { DragEvent, FormEvent } from "react"

const THEME_JSON_PLACEHOLDER = `{
  "version": 1,
  "name": "Aurora",
  "dark": { "background": "#10131a", "accent": "#7dd3fc" },
  "light": { "background": "#f7f8fb", "accent": "#0369a1" }
}`

/**
 * Adds themes from Alloy theme files or VS Code color themes, chosen as files
 * or pasted as JSON. Files are added as soon as they're picked; pasted JSON
 * waits for the button.
 */
export function ThemeImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [text, setText] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setText("")
    setErrors([])
    setDragging(false)
  }, [open])

  function add(sources: readonly ThemeSource[]): boolean {
    const result = importThemeSources(sources)
    setErrors(result.errors)
    if (result.themes.length === 0) return false

    const names = getThemeState().customThemes.map((theme) => theme.name)
    const ids = result.themes.map((draft) => {
      const id = newCustomThemeId()
      const name = uniqueThemeName(draft.name, names)
      names.push(name)
      saveCustomTheme({ ...draft, id, name, guided: false })
      return id
    })
    const [first] = ids
    if (first) selectThemeFamily(first)
    toast.success(tp(ids.length, "Added {count} theme", "Added {count} themes"))
    if (result.errors.length === 0) onOpenChange(false)
    return true
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const sources = await Promise.all(
      Array.from(files, async (file) => ({
        text: await file.text(),
        name: file.name,
      })),
    )
    add(sources)
  }

  function addPasted(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!text.trim()) return
    if (add([{ text, name: null }])) setText("")
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent variant="secondary" className="sm:max-w-xl">
        <form onSubmit={addPasted}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t("Add a theme")}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t(
                "Import an Alloy theme file or a VS Code color theme. Themes stay in this browser.",
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-dashed p-3 transition-colors",
                dragging ? "border-accent bg-accent-soft" : "border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("Theme files")}</p>
                <p className="text-foreground-dim text-xs">
                  {t("Drop Alloy or VS Code .json files here.")}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <FileUpIcon />
                {t("Choose files")}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,.jsonc,application/json"
                multiple
                hidden
                onChange={(event) => {
                  void addFiles(event.target.files)
                  event.target.value = ""
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="theme-import-json"
                className="text-sm font-medium"
              >
                {t("Theme JSON")}
              </label>
              <Textarea
                id="theme-import-json"
                value={text}
                spellCheck={false}
                placeholder={THEME_JSON_PLACEHOLDER}
                className="min-h-40 font-mono text-xs"
                onChange={(event) => setText(event.target.value)}
              />
              <p className="text-foreground-dim text-xs">
                {t(
                  "Colors you leave out are derived from the background and accent.",
                )}
              </p>
            </div>

            {errors.length > 0 ? (
              <ul
                role="alert"
                className="text-destructive flex flex-col gap-1 text-sm"
              >
                {errors.map((error) => (
                  <li key={error} className="flex items-start gap-2">
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 break-words">{error}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={<Button type="button" variant="ghost" />}
            >
              {t("Cancel")}
            </ResponsiveDialogClose>
            <Button type="submit" variant="primary" disabled={!text.trim()}>
              <PlusIcon />
              {t("Add theme")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
