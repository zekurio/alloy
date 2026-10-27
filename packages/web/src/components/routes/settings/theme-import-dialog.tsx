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
import { getThemeState, selectThemeFamily } from "@alloy/ui/lib/theme"
import {
  importThemeSources,
  newCustomThemeId,
  uniqueThemeName,
  type ThemeSource,
} from "@alloy/ui/lib/theme-custom"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { CircleAlertIcon, FileUpIcon, PlusIcon } from "lucide-react"
import { useRef, useState } from "react"
import type { DragEvent } from "react"

import { saveAccountTheme } from "@/lib/account-themes"
import { errorMessage } from "@/lib/error-message"

const THEME_JSON_PLACEHOLDER = `{
  "version": 2,
  "name": "Aurora",
  "variants": [
    { "appearance": "light",
      "colors": { "background": "#f7f8fb", "accent": "#0369a1" } },
    { "name": "Midnight", "appearance": "dark",
      "colors": { "background": "#10131a", "accent": "#7dd3fc" } }
  ]
}`

type ImportResult = {
  added: string[]
  errors: string[]
}

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
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent variant="secondary" className="sm:max-w-xl">
        {/* The popup unmounts on close, so each opening starts empty. */}
        <ThemeImportForm onDone={() => onOpenChange(false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ThemeImportForm({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const importer = useMutation({
    mutationFn: async (
      sources: readonly ThemeSource[],
    ): Promise<ImportResult> => {
      const result = importThemeSources(sources)
      if (result.themes.length === 0) {
        return { added: [], errors: result.errors }
      }

      const errors = [...result.errors]
      const names = getThemeState().customThemes.map((theme) => theme.name)
      const added: string[] = []
      for (const draft of result.themes) {
        const name = uniqueThemeName(draft.name, names)
        try {
          const saved = await saveAccountTheme({
            ...draft,
            id: newCustomThemeId(),
            name,
            guided: false,
          })
          names.push(saved.name)
          added.push(saved.id)
        } catch (cause) {
          // The rest would most likely fail the same way, at the theme limit
          // or while offline.
          errors.push(
            t("{file}: {error}", {
              file: name,
              error: errorMessage(cause, t("Couldn't save theme")),
            }),
          )
          break
        }
      }
      return { added, errors }
    },
    onSuccess: ({ added, errors }) => {
      const [first] = added
      if (!first) return
      selectThemeFamily(first)
      toast.success(
        tp(added.length, "Added {count} theme", "Added {count} themes"),
      )
      if (errors.length === 0) onDone()
    },
  })
  const adding = importer.isPending
  const errors = importer.data?.errors ?? []
  const form = useForm({
    defaultValues: { text: "" },
    onSubmit: async ({ value, formApi }) => {
      if (!value.text.trim() || importer.isPending) return
      const { added } = await importer.mutateAsync([
        { text: value.text, name: null },
      ])
      if (added.length > 0) formApi.reset()
    },
  })
  const text = useStore(form.store, (state) => state.values.text)

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const sources = await Promise.all(
      Array.from(files, async (file) => ({
        text: await file.text(),
        name: file.name,
      })),
    )
    importer.mutate(sources)
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t("Add a theme")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t(
            "Import Alloy theme files or VS Code color themes into your account.",
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
            disabled={adding}
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
          <label htmlFor="theme-import-json" className="text-sm font-medium">
            {t("Theme JSON")}
          </label>
          <Textarea
            id="theme-import-json"
            value={text}
            spellCheck={false}
            placeholder={THEME_JSON_PLACEHOLDER}
            className="min-h-48 font-mono text-xs"
            onChange={(event) => form.setFieldValue("text", event.target.value)}
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
        <Button
          type="submit"
          variant="primary"
          disabled={!text.trim() || adding}
        >
          <PlusIcon />
          {t("Add theme")}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  )
}
