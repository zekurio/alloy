import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { Textarea } from "@alloy/ui/components/textarea"
import {
  buildThemeFile,
  parseThemeMetadata,
  themeFileName,
} from "@alloy/ui/lib/custom-theme"
import { toast } from "@alloy/ui/lib/toast"
import {
  DownloadIcon,
  RotateCcwIcon,
  SearchIcon,
  Share2Icon,
  UploadIcon,
} from "lucide-react"
import { useRef, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { ThemeImportDialog } from "@/components/routes/settings/theme-import-dialog"
import { ThemeTokenEditor } from "@/components/routes/settings/theme-token-editor"
import { startBlobDownload } from "@/lib/browser-download"
import { useCustomThemeEditor } from "@/lib/custom-theme"

const CSS_PLACEHOLDER = `:root {\n  --background: #08090b;\n  --accent: #7c5cff;\n}`

/**
 * This browser's own theme. Stored locally rather than on the account, so it
 * applies instantly and never travels to anyone else.
 */
export function CustomThemeSettings() {
  const { theme, update } = useCustomThemeEditor()
  const [search, setSearch] = useState("")
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  function shareTheme() {
    void navigator.clipboard
      .writeText(theme.css)
      .then(() => toast.success(t("Theme CSS copied")))
      .catch(() => toast.error(t("Couldn't copy the theme")))
  }

  function exportTheme() {
    const metadata = parseThemeMetadata(theme.css)
    const file = new Blob([buildThemeFile(theme.css, metadata)], {
      type: "text/css",
    })
    if (!startBlobDownload(file, themeFileName(metadata.name))) {
      toast.error(t("Couldn't export the theme"))
    }
  }

  async function readImport(file: File | undefined) {
    // Reset first: picking the same file twice has to re-fire `change`.
    if (fileInput.current) fileInput.current.value = ""
    if (!file) return
    const css = await file.text()
    if (!css.trim()) {
      toast.error(t("That file is empty"))
      return
    }
    setPendingImport(css)
  }

  return (
    <>
      <SettingsSubsection
        id="theme"
        title={t("Theme")}
        description={t(
          "Custom CSS for this browser. It applies as you type and is never shared with anyone else on this server.",
        )}
      >
        <SettingRows>
          <SettingRow
            title={t("Use this server's theme")}
            description={t(
              "Apply the CSS the administrator set for everyone. Turn this off to use only your own.",
            )}
          >
            <Switch
              checked={theme.serverThemeEnabled}
              onCheckedChange={(serverThemeEnabled) =>
                update({ serverThemeEnabled })
              }
            />
          </SettingRow>
          <SettingRow
            title={t("Use my custom CSS")}
            description={t(
              "Turning this off keeps your CSS but stops applying it.",
            )}
          >
            <Switch
              checked={theme.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </SettingRow>
        </SettingRows>
      </SettingsSubsection>

      <SettingsSubsection
        id="theme-tokens"
        title={t("Custom theme tokens")}
        description={t(
          "Fine-tune core colors and fonts. Changes here are stored as custom CSS overrides and sync with the editor below.",
        )}
        action={
          <InputGroup className="w-44 sm:w-56">
            <InputGroupAddon>
              <SearchIcon className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search tokens")}
              aria-label={t("Search tokens")}
            />
          </InputGroup>
        }
      >
        <ThemeTokenEditor
          css={theme.css}
          search={search}
          onCssChange={(css) => update({ css })}
        />
      </SettingsSubsection>

      <SettingsSubsection
        id="theme-css"
        title={t("Custom CSS overrides")}
        description={t(
          "Write CSS to override any theme token. Broken CSS can make the app unusable — clear this field to recover.",
        )}
      >
        <Textarea
          value={theme.css}
          spellCheck={false}
          onChange={(event) => update({ css: event.target.value })}
          placeholder={CSS_PLACEHOLDER}
          aria-label={t("Custom CSS")}
          className="min-h-56 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => update({ css: "" })}
            disabled={!theme.css}
          >
            <RotateCcwIcon />
            {t("Reset all overrides to theme default")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon />
            {t("Import theme")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={exportTheme}
            disabled={!theme.css}
          >
            <DownloadIcon />
            {t("Export theme")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={shareTheme}
            disabled={!theme.css}
          >
            <Share2Icon />
            {t("Share this theme")}
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".css,text/css"
          className="hidden"
          onChange={(event) =>
            void readImport(event.target.files?.[0]).catch(() =>
              toast.error(t("Couldn't read that file")),
            )
          }
        />
        <ThemeImportDialog
          css={pendingImport}
          onOpenChange={(open) => {
            if (!open) setPendingImport(null)
          }}
          onApply={(css) => {
            update({ css })
            setPendingImport(null)
            toast.success(t("Theme imported"))
          }}
        />
      </SettingsSubsection>
    </>
  )
}
