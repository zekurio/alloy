import type { AdminRuntimeConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { setServerThemeAccent } from "@alloy/ui/lib/theme"
import {
  defaultThemeAccent,
  normalizeThemeColor,
} from "@alloy/ui/lib/theme-colors"
import { cn } from "@alloy/ui/lib/utils"
import { CheckIcon, RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { HexColorInput } from "@/components/routes/settings/hex-color-input"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"

/** Starting points; any color works, and contrast is fixed up per theme. */
const ACCENT_PRESETS = [
  "#d0c4eb",
  "#6d8cf5",
  "#38bdf8",
  "#2dd4bf",
  "#4ade80",
  "#facc15",
  "#fb923c",
  "#f43f5e",
  "#ec4899",
]

/**
 * The accent of the Alloy base themes for everyone on the server. The page
 * previews the draft right away; members who picked their own accent or a
 * different theme keep theirs.
 */
export function AdminAccentSettings({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.appearance.accentColor
  const [draft, setDraft] = useState<string | null>(saved)
  const savedRef = useRef(saved)
  const saveAccent = useAdminConfigMutation(
    (accentColor: string | null) =>
      api.admin.updateAppearanceConfig({ accentColor }),
    { authConfigChanged: true },
  )

  useEffect(() => {
    savedRef.current = saved
    setDraft(saved)
  }, [saved])
  useEffect(() => setServerThemeAccent(draft), [draft])
  // Leaving without saving drops the preview.
  useEffect(() => () => setServerThemeAccent(savedRef.current), [])

  useSettingsSaveBar({
    dirty: draft !== saved,
    saving: saveAccent.isPending,
    save: async () => {
      await saveAccent.mutateAsync(draft)
    },
    discard: () => setDraft(saved),
  })

  return (
    <SettingsSubsection
      id="accent-color"
      title={t("Accent color")}
      description={t(
        "Colors buttons, links, and highlights in Alloy's own themes for everyone on this server. Members can still choose their own.",
      )}
    >
      <SettingRows>
        <SettingRow
          title={t("Server accent")}
          htmlFor="server-accent"
          stack
          footer={
            <div
              role="group"
              aria-label={t("Suggested accents")}
              className="flex flex-wrap gap-2"
            >
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={preset}
                  aria-pressed={draft === preset}
                  onClick={() => setDraft(preset)}
                  className={cn(
                    "focus-visible:ring-ring focus-visible:ring-offset-background grid size-7 place-items-center rounded-full border-2 transition-[border-color] outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    draft === preset
                      ? "border-foreground"
                      : "border-transparent hover:border-border-emphasis",
                  )}
                  style={{ background: preset }}
                >
                  {draft === preset ? (
                    <CheckIcon
                      aria-hidden
                      className="size-3.5 text-black/80"
                      strokeWidth={3}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          }
        >
          <HexColorInput
            id="server-accent"
            value={draft ?? defaultThemeAccent("dark")}
            label={t("Server accent")}
            className="text-xs"
            commit={normalizeThemeColor}
            onChange={(color) => setDraft(color.toLowerCase())}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!draft}
              onClick={() => setDraft(null)}
            >
              <RotateCcwIcon />
              {t("Reset")}
            </Button>
          </HexColorInput>
        </SettingRow>
      </SettingRows>
    </SettingsSubsection>
  )
}
