import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ChevronDownIcon } from "lucide-react"

import { SignInButtonFields } from "./admin-auth-provider-button"
import {
  CallbackUrlField,
  ProviderTextField,
  providerFieldId,
  TokenAuthMethodField,
  ToggleField,
} from "./admin-auth-provider-fields"
import type { ProviderDraft } from "./admin-auth-provider-utils"
import { callbackURLForProvider } from "./admin-auth-provider-utils"

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
