import { publicOAuthProviderIconUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { ImageUpIcon, UserKeyIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ChangeEvent } from "react"

import { OAuthButton } from "@/components/auth/oauth-button"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import {
  ProviderTextField,
  providerFieldId,
} from "./admin-auth-provider-fields"
import type { ProviderDraft } from "./admin-auth-provider-utils"
import { HexColorInput } from "./hex-color-input"

/**
 * Everything that shapes the sign-in button users see: a live preview of the
 * button, its colors, and the icon source (upload or URL). It sits in the open
 * part of the dialog because it is what admins actually tune; only protocol
 * endpoints and claim mappings stay under Advanced.
 */
export function SignInButtonFields({
  draft,
  editingProviderId,
  onChange,
}: {
  draft: ProviderDraft
  editingProviderId: string | null
  onChange: (next: Partial<ProviderDraft>) => void
}) {
  const iconSrc = useProviderIconSrc(draft)

  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{t("Sign-in button")}</h3>
      <SignInButtonPreview draft={draft} iconSrc={iconSrc} />
      <div className="grid gap-4 md:grid-cols-2">
        <ProviderColorField
          fieldId="button-color"
          editingProviderId={editingProviderId}
          label={t("Button color")}
          placeholder="#5865F2"
          value={draft.buttonColor}
          // Empty keeps the theme styling, so the swatch shows the token the
          // OAuth button falls back to.
          fallbackColor="var(--surface-raised)"
          onChange={(buttonColor) => onChange({ buttonColor })}
        />
        <ProviderColorField
          fieldId="button-text-color"
          editingProviderId={editingProviderId}
          label={t("Button text color")}
          placeholder="#ffffff"
          value={draft.buttonTextColor}
          fallbackColor="var(--foreground)"
          onChange={(buttonTextColor) => onChange({ buttonTextColor })}
        />
        <ProviderIconField
          draft={draft}
          iconSrc={iconSrc}
          onChange={onChange}
        />
        <ProviderTextField
          fieldId="icon-url"
          editingProviderId={editingProviderId}
          label={t("Icon URL")}
          value={draft.iconUrl}
          onChange={(iconUrl) => onChange({ iconUrl })}
          // Stored icons use relative paths, which native URL inputs reject.
          type={
            publicOAuthProviderIconUrl(draft.iconUrl.trim()) ? "text" : "url"
          }
          inputMode="url"
          className="md:col-span-2"
          description={t("Downloaded and stored on this server when you save.")}
        />
      </div>
    </section>
  )
}

/** The real sign-in button rendered from the draft, so edits show up live. */
function SignInButtonPreview({
  draft,
  iconSrc,
}: {
  draft: ProviderDraft
  iconSrc: string | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground-muted text-xs font-medium">
        {t("Preview")}
      </span>
      {/* Non-interactive: it mirrors the login button without starting a flow. */}
      <OAuthButton
        providerId={draft.providerId.trim()}
        displayName={previewDisplayName(draft)}
        buttonColor={draft.buttonColor || undefined}
        buttonTextColor={draft.buttonTextColor || undefined}
        iconUrl={iconSrc}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none w-full"
      />
    </div>
  )
}

/** Falls back to the id being typed, so the preview always reads as a button. */
function previewDisplayName(draft: ProviderDraft): string {
  return draft.displayName.trim() || draft.providerId.trim() || t("Provider")
}

/**
 * What the sign-in button shows right now: the file picked for upload, or the
 * managed icon path already stored for this provider. External URLs never
 * render, because only same-origin icons pass the login page's filter.
 */
function useProviderIconSrc(draft: ProviderDraft): string | undefined {
  const file = draft.iconFile
  const [fileSrc, setFileSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setFileSrc(null)
      return
    }
    const url = createObjectUrl(file, "provider icon preview")
    setFileSrc(url)
    return () => revokeObjectUrl(url, "provider icon preview")
  }, [file])

  return (
    fileSrc ?? publicOAuthProviderIconUrl(draft.iconUrl.trim() || undefined)
  )
}

function ProviderColorField({
  fieldId,
  editingProviderId,
  label,
  value,
  placeholder,
  fallbackColor,
  onChange,
}: {
  fieldId: string
  editingProviderId: string | null
  label: string
  value: string
  placeholder: string
  /** Shown in the swatch while no color is set. */
  fallbackColor: string
  onChange: (value: string) => void
}) {
  const id = providerFieldId(fieldId, editingProviderId)

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* Stored colors are always `#rrggbb`; anything else stays text
          mid-edit and is never previewed or submitted. */}
      <HexColorInput
        id={id}
        value={value}
        label={label}
        swatch={value || fallbackColor}
        placeholder={placeholder}
        allowEmpty
        onChange={onChange}
      >
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("Use the theme color")}
            onClick={() => onChange("")}
          >
            <XIcon />
          </Button>
        ) : null}
      </HexColorInput>
      <FieldDescription>
        {t("Leave empty to use the theme color.")}
      </FieldDescription>
    </Field>
  )
}

function ProviderIconField({
  draft,
  iconSrc,
  onChange,
}: {
  draft: ProviderDraft
  iconSrc: string | undefined
  onChange: (next: Partial<ProviderDraft>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const removable = Boolean(draft.iconFile || draft.iconUrl.trim())

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Reset so picking the same file again still fires a change event.
    event.target.value = ""
    onChange({ iconFile: file })
  }

  return (
    <Field className="md:col-span-2">
      <FieldLabel>{t("Icon")}</FieldLabel>
      <div className="flex items-center gap-3">
        <span className="border-border bg-surface-raised inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
          {iconSrc ? (
            <img src={iconSrc} alt="" className="size-8 object-contain" />
          ) : (
            <UserKeyIcon className="text-foreground-dim size-5" />
          )}
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <ImageUpIcon />
            {t("Upload icon")}
          </Button>
          {removable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("Remove icon")}
              onClick={() => onChange({ iconFile: null, iconUrl: "" })}
            >
              {t("Remove")}
            </Button>
          ) : null}
          {draft.iconFile ? (
            <span className="text-foreground-muted min-w-0 truncate text-xs">
              {draft.iconFile.name}
            </span>
          ) : null}
        </div>
      </div>
      <FieldDescription>
        {t(
          "PNG, JPEG, WebP, or SVG, stored on this server and shown on the sign-in button. Size is controlled by Upload limits.",
        )}
      </FieldDescription>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={selectFile}
      />
    </Field>
  )
}
