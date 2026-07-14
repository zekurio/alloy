import type { OAuthTokenAuthMethod } from "@alloy/api"
import {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
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
import { toast } from "@alloy/ui/lib/toast"
import { ChevronDownIcon, CopyIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { copyTextToClipboard } from "@/lib/clipboard"

import type { ProviderDraft } from "./admin-auth-provider-utils"
import { callbackURLForProvider } from "./admin-auth-provider-utils"

const TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const

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

      <div className="border-border/70 rounded-lg border">
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
    <div className="border-border/70 grid gap-4 border-t p-3 md:grid-cols-2">
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
      <ProviderColorFields
        draft={draft}
        editingProviderId={editingProviderId}
        onChange={onChange}
      />
      <ProviderTextField
        fieldId="icon-url"
        editingProviderId={editingProviderId}
        label={t("Icon URL")}
        value={draft.iconUrl}
        onChange={(iconUrl) => onChange({ iconUrl })}
        type="url"
      />
    </div>
  )
}

function ProviderColorFields({
  draft,
  editingProviderId,
  onChange,
}: {
  draft: ProviderDraft
  editingProviderId: string | null
  onChange: (next: Partial<ProviderDraft>) => void
}) {
  const fields = [
    ["buttonColor", "button-color", t("Button color"), "#5865F2"],
    ["buttonTextColor", "button-text-color", t("Button text color"), "#ffffff"],
  ] as const
  return fields.map(([key, fieldId, label, placeholder]) => (
    <ProviderTextField
      key={key}
      fieldId={fieldId}
      editingProviderId={editingProviderId}
      label={label}
      value={draft[key]}
      onChange={(value) => onChange({ [key]: value })}
      placeholder={placeholder}
      pattern="#[0-9a-fA-F]{6}"
    />
  ))
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
  ...props
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
} & Omit<ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return (
    <Field>
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
  async function copyCallbackUrl() {
    const copied = await copyTextToClipboard(value, {
      action: "copy OAuth callback URL",
    })
    if (copied) {
      toast.success(t("Callback URL copied"))
      return
    }
    toast.error(t("Couldn't copy callback URL"))
  }

  return (
    <Field className="md:col-span-2">
      <FieldLabel htmlFor={id}>{t("Callback URL")}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="font-mono" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("Copy callback URL")}
          onClick={() => void copyCallbackUrl()}
        >
          <CopyIcon />
        </Button>
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
