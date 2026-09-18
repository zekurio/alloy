import type { OAuthTokenAuthMethod } from "@alloy/api"
import {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  publicOAuthProviderIconUrl,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ColorPicker } from "@alloy/ui/components/color-picker"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Switch } from "@alloy/ui/components/switch"
import {
  ChevronDownIcon,
  CopyIcon,
  ImageUpIcon,
  UserKeyIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, ComponentProps } from "react"

import { OAuthButton } from "@/components/auth/oauth-button"
import { copyTextToClipboard } from "@/lib/clipboard"
import { useActionFeedback } from "@/lib/use-action-feedback"

import type { ProviderDraft } from "./admin-auth-provider-utils"
import { callbackURLForProvider } from "./admin-auth-provider-utils"

const TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const

// Colors the server stores are always `#rrggbb`; anything else stays text
// mid-edit and is never previewed or submitted.
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export function OAuthProviderForm({
  draft,
  editingProviderId,
  clientSecretSet,
  authBaseURL,
  advancedOpen,
  onAdvancedOpenChange,
  onChange,
}: {
  draft: ProviderDraft
  editingProviderId: string | null
  clientSecretSet: boolean
  authBaseURL: string
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
  onChange: (next: Partial<ProviderDraft>) => void
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <ProviderTextField
          fieldId="provider-id"
          editingProviderId={editingProviderId}
          label={t("Provider ID")}
          value={draft.providerId}
          onChange={(providerId) => onChange({ providerId })}
          maxLength={64}
          pattern="[a-z0-9-]+"
          required
          disabled={editingProviderId !== null}
          description={t("Lowercase letters, numbers, and hyphens only.")}
        />
        <ProviderTextField
          fieldId="provider-name"
          editingProviderId={editingProviderId}
          label={t("Display name")}
          value={draft.displayName}
          onChange={(displayName) => onChange({ displayName })}
          maxLength={64}
          required
        />
        <CallbackUrlField
          id={providerFieldId("callback-url", editingProviderId)}
          value={callbackURLForProvider(authBaseURL, draft.providerId)}
        />
        <ProviderTextField
          fieldId="client-id"
          editingProviderId={editingProviderId}
          label={t("Client ID")}
          value={draft.clientId}
          onChange={(clientId) => onChange({ clientId })}
          required
        />
        <ProviderTextField
          fieldId="client-secret"
          editingProviderId={editingProviderId}
          label={t("Client secret")}
          value={draft.clientSecret}
          onChange={(clientSecret) => onChange({ clientSecret })}
          type="password"
          placeholder={
            editingProviderId && clientSecretSet ? t("Unchanged") : undefined
          }
          required={editingProviderId === null && !clientSecretSet}
        />
        <ProviderTextField
          fieldId="discovery-url"
          editingProviderId={editingProviderId}
          label={t("Discovery URL")}
          value={draft.discoveryUrl}
          onChange={(discoveryUrl) => onChange({ discoveryUrl })}
          type="url"
        />
        <ToggleField
          label={t("Enabled")}
          description={t("Allow users to sign in with this provider.")}
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
      </div>

      <SignInButtonFields
        draft={draft}
        editingProviderId={editingProviderId}
        onChange={onChange}
      />

      <div className="border-border rounded-lg border">
        <Button
          type="button"
          variant="ghost"
          className="flex w-full justify-between rounded-lg px-3 py-2"
          onClick={() => onAdvancedOpenChange(!advancedOpen)}
        >
          <span>{t("Advanced")}</span>
          <ChevronDownIcon
            className={
              advancedOpen
                ? "rotate-180 transition-transform"
                : "transition-transform"
            }
          />
        </Button>
        {advancedOpen ? (
          <AdvancedProviderFields
            draft={draft}
            editingProviderId={editingProviderId}
            onChange={onChange}
          />
        ) : null}
      </div>
    </>
  )
}

/**
 * Everything that shapes the sign-in button users see: a live preview of the
 * button, its colors, and the icon source (upload or URL). It sits in the open
 * part of the dialog because it is what admins actually tune; only protocol
 * endpoints and claim mappings stay under Advanced.
 */
function SignInButtonFields({
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
          type="url"
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
    const url = URL.createObjectURL(file)
    setFileSrc(url)
    return () => URL.revokeObjectURL(url)
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
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  function updateDraft(next: string) {
    setDraft(next)
    const color = next.trim()
    if (color === "" || HEX_COLOR_RE.test(color)) onChange(color)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          pattern="#[0-9a-fA-F]{6}"
          className="min-w-0 flex-1 font-mono"
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => setDraft(value)}
        />
        <ColorPicker
          value={value || fallbackColor}
          allowAlpha={false}
          label={label}
          onValueChange={(color) => {
            setDraft(color)
            onChange(color)
          }}
        />
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("Use the theme color")}
            onClick={() => {
              setDraft("")
              onChange("")
            }}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
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
          "PNG, JPEG, WebP, or SVG up to 2 MB, stored on this server and shown on the sign-in button.",
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

function AdvancedProviderFields({
  draft,
  editingProviderId,
  onChange,
}: {
  draft: ProviderDraft
  editingProviderId: string | null
  onChange: (next: Partial<ProviderDraft>) => void
}) {
  return (
    <div className="border-border grid gap-4 border-t p-3 md:grid-cols-2">
      <ProviderTextField
        fieldId="authorization-url"
        editingProviderId={editingProviderId}
        label={t("Authorization URL")}
        value={draft.authorizationUrl}
        onChange={(authorizationUrl) => onChange({ authorizationUrl })}
        type="url"
      />
      <ProviderTextField
        fieldId="token-url"
        editingProviderId={editingProviderId}
        label={t("Token URL")}
        value={draft.tokenUrl}
        onChange={(tokenUrl) => onChange({ tokenUrl })}
        type="url"
      />
      <ProviderTextField
        fieldId="user-info-url"
        editingProviderId={editingProviderId}
        label={t("User info URL")}
        value={draft.userInfoUrl}
        onChange={(userInfoUrl) => onChange({ userInfoUrl })}
        type="url"
      />
      <ProviderTextField
        fieldId="scopes"
        editingProviderId={editingProviderId}
        label={t("Scopes")}
        value={draft.scopes}
        onChange={(scopes) => onChange({ scopes })}
        description={t("Separate scopes with spaces.")}
      />
      <TokenAuthMethodField
        id={providerFieldId("token-auth", editingProviderId)}
        value={draft.tokenAuthMethod}
        onChange={(tokenAuthMethod) => onChange({ tokenAuthMethod })}
      />
      <ToggleField
        label={t("PKCE")}
        description={t(
          "Secure the authorization flow with Proof Key for Code Exchange.",
        )}
        checked={draft.pkce}
        onCheckedChange={(pkce) => onChange({ pkce })}
      />
      <ProviderTextField
        fieldId="uid-claim"
        editingProviderId={editingProviderId}
        label={t("UID claim")}
        value={draft.uidClaim}
        onChange={(uidClaim) => onChange({ uidClaim })}
      />
      <ProviderTextField
        fieldId="username-claim"
        editingProviderId={editingProviderId}
        label={t("Username claim")}
        value={draft.usernameClaim}
        onChange={(usernameClaim) => onChange({ usernameClaim })}
      />
      <ProviderTextField
        fieldId="avatar-claim"
        editingProviderId={editingProviderId}
        label={t("Avatar claim")}
        value={draft.avatarClaim}
        onChange={(avatarClaim) => onChange({ avatarClaim })}
      />
      <ProviderTextField
        fieldId="quota-claim"
        editingProviderId={editingProviderId}
        label={t("Quota claim")}
        value={draft.quotaClaim}
        onChange={(quotaClaim) => onChange({ quotaClaim })}
      />
      <ProviderTextField
        fieldId="role-claim"
        editingProviderId={editingProviderId}
        label={t("Role claim")}
        value={draft.roleClaim}
        onChange={(roleClaim) => onChange({ roleClaim })}
      />
    </div>
  )
}

function ProviderTextField({
  fieldId,
  editingProviderId,
  ...props
}: {
  fieldId: string
  editingProviderId: string | null
} & Omit<ComponentProps<typeof TextField>, "id">) {
  return (
    <TextField id={providerFieldId(fieldId, editingProviderId)} {...props} />
  )
}

function TextField({
  id,
  label,
  description,
  value,
  onChange,
  className,
  ...props
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  /** Wrapper class, for grid placement. */
  className?: string
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "value" | "onChange" | "className"
>) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function TokenAuthMethodField({
  id,
  value,
  onChange,
}: {
  id: string
  value: OAuthTokenAuthMethod
  onChange: (value: OAuthTokenAuthMethod) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("Token auth method")}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          const method = TOKEN_AUTH_METHODS.find((option) => option === next)
          if (method) onChange(method)
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue>{tokenAuthMethodLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TOKEN_AUTH_METHODS.map((method) => (
            <SelectItem key={method} value={method}>
              {tokenAuthMethodLabel(method)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 self-end">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-foreground-dim mt-0.5 text-xs">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="shrink-0"
      />
    </div>
  )
}

function CallbackUrlField({ id, value }: { id: string; value: string }) {
  const copyFeedback = useActionFeedback()
  async function copyCallbackUrl() {
    await copyFeedback.run(async () => {
      if (
        !(await copyTextToClipboard(value, {
          action: "copy OAuth callback URL",
        }))
      ) {
        throw new Error(t("Couldn't copy callback URL"))
      }
    }, t("Couldn't copy callback URL"))
  }

  return (
    <Field className="md:col-span-2">
      <FieldLabel htmlFor={id}>{t("Callback URL")}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="font-mono" />
        <FeedbackButton
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("Copy callback URL")}
          state={copyFeedback.feedback.state}
          pendingLabel={<span className="sr-only">{t("Copying…")}</span>}
          successLabel={<span className="sr-only">{t("Copied")}</span>}
          errorLabel={<span className="sr-only">{t("Try again")}</span>}
          title={
            copyFeedback.feedback.state === "error"
              ? copyFeedback.feedback.message
              : undefined
          }
          onClick={() => void copyCallbackUrl()}
        >
          <CopyIcon />
        </FeedbackButton>
      </div>
      <FieldDescription>
        {t("Register this redirect URI with the provider.")}
      </FieldDescription>
    </Field>
  )
}

function providerFieldId(field: string, providerId: string | null) {
  return providerId ? `${field}-${providerId}` : `new-${field}`
}

function tokenAuthMethodLabel(method: OAuthTokenAuthMethod) {
  if (method === OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD) {
    return t("Client secret basic")
  }
  return t("Client secret post")
}
