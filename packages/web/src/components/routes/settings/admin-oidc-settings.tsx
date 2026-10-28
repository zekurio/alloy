import type {
  AdminOidcConfig,
  AdminOidcConfigPatch,
  AdminRuntimeConfig,
  OAuthTokenAuthMethod,
} from "@alloy/api"
import { OIDC_PROVIDER_ID } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useForm, useStore } from "@tanstack/react-form"
import { ChevronDownIcon, InfoIcon } from "lucide-react"
import { useState } from "react"
import type { ComponentProps } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"

import { AdminDefaultNote, sameConfigValue } from "./admin-default-note"
import {
  CallbackUrlField,
  TextField,
  TokenAuthMethodField,
  tokenAuthMethodLabel,
  ToggleField,
} from "./admin-oidc-fields"

/** Text fields hold only a saved value; empty shows the default instead. */
const TEXT_FIELDS = [
  "displayName",
  "clientId",
  "issuerUrl",
  "authorizationUrl",
  "tokenUrl",
  "userInfoUrl",
  "uidClaim",
  "usernameClaim",
  "avatarClaim",
  "quotaClaim",
  "roleClaim",
] as const

type TextFieldKey = (typeof TEXT_FIELDS)[number]
type ToggleKey = "enabled" | "allowSignUp" | "pkce" | "fetchUserInfo"

type OidcDraft = Record<TextFieldKey, string> &
  Record<ToggleKey, boolean> & {
    scopes: string
    tokenAuthMethod: OAuthTokenAuthMethod
    clientSecret: string
    /** Drop the secret saved here, so the environment's applies again. */
    dropSecret: boolean
  }

type SetDraftField = <K extends keyof OidcDraft>(
  key: K,
  value: OidcDraft[K],
) => void

function textValue(value: string | undefined, defaultValue?: string): string {
  return value === undefined || value === defaultValue ? "" : value
}

function draftFromConfig(
  config: AdminOidcConfig,
  defaults: AdminOidcConfig,
): OidcDraft {
  // SAFETY: the entries cover every key of the closed TEXT_FIELDS list.
  const text = Object.fromEntries(
    TEXT_FIELDS.map((key) => [key, textValue(config[key], defaults[key])]),
  ) as Record<TextFieldKey, string>
  const scopes = config.scopes.join(" ")
  return {
    ...text,
    enabled: config.enabled,
    allowSignUp: config.allowSignUp,
    pkce: config.pkce,
    fetchUserInfo: config.fetchUserInfo,
    scopes: scopes === defaults.scopes.join(" ") ? "" : scopes,
    tokenAuthMethod: config.tokenAuthMethod,
    clientSecret: "",
    dropSecret: false,
  }
}

/** The submitted provider. A field left empty falls back to its default. */
function patchFromDraft(draft: OidcDraft): AdminOidcConfigPatch {
  const patch: AdminOidcConfigPatch = {
    enabled: draft.enabled,
    allowSignUp: draft.allowSignUp,
    pkce: draft.pkce,
    fetchUserInfo: draft.fetchUserInfo,
    tokenAuthMethod: draft.tokenAuthMethod,
  }
  for (const key of TEXT_FIELDS) {
    const value = draft[key].trim()
    if (value) patch[key] = value
  }
  const scopes = draft.scopes.trim().split(/\s+/).filter(Boolean)
  if (scopes.length > 0) patch.scopes = scopes
  const secret = draft.clientSecret.trim()
  if (secret) patch.clientSecret = secret
  else if (draft.dropSecret) patch.clientSecret = null
  return patch
}

function onOff(value: boolean): string {
  return value ? t("On") : t("Off")
}

export function OidcSettings({ config }: { config: AdminRuntimeConfig }) {
  const defaults = config.defaults.oidc
  const saved = draftFromConfig(config.oidc, defaults)
  const saveOidc = useAdminConfigMutation(api.admin.updateOidcConfig, {
    authConfigChanged: true,
  })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // The form adopts a refetched config only while untouched, so edits survive
  // a refetch.
  const form = useForm({
    defaultValues: saved,
    onSubmit: async ({ value, formApi }) => {
      const updated = await saveOidc.mutateAsync(patchFromDraft(value))
      formApi.reset(draftFromConfig(updated.oidc, updated.defaults.oidc), {
        keepDefaultValues: true,
      })
    },
  })
  const draft = useStore(form.store, (state) => state.values)
  const setField: SetDraftField = (
    key: keyof OidcDraft,
    value: OidcDraft[keyof OidcDraft],
  ) => form.setFieldValue(key, value)

  useSettingsSaveBar(form, {
    dirty: !sameConfigValue(draft, saved),
    saving: saveOidc.isPending,
  })

  const text = (key: TextFieldKey): ComponentProps<typeof TextField> => ({
    id: `oidc-${key}`,
    label: "",
    value: draft[key],
    placeholder: defaults[key],
    onChange: (value) => setField(key, value),
  })

  const toggleNote = (key: ToggleKey) => (
    <AdminDefaultNote
      value={draft[key]}
      defaultValue={defaults[key]}
      label={onOff(defaults[key])}
      onReset={() => setField(key, defaults[key])}
    />
  )

  return (
    <SettingsSubsection
      id="single-sign-on"
      title={t("Single sign-on")}
      description={t(
        "Sign in through an OpenID Connect provider. Empty fields use the value from the environment or Alloy's default, shown as the placeholder.",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleField
            label={t("Enabled")}
            description={t("Show the sign-in button for this provider.")}
            note={toggleNote("enabled")}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setField("enabled", enabled)}
          />
          <ToggleField
            label={t("Create accounts")}
            description={t(
              "Create an account the first time someone signs in with this provider. When off, only users who already linked it can sign in.",
            )}
            note={toggleNote("allowSignUp")}
            checked={draft.allowSignUp}
            onCheckedChange={(allowSignUp) =>
              setField("allowSignUp", allowSignUp)
            }
          />
          <TextField
            {...text("displayName")}
            label={t("Display name")}
            description={t("Shown on the button as Continue with {name}.", {
              name: draft.displayName.trim() || defaults.displayName,
            })}
            maxLength={64}
          />
          <TextField
            {...text("issuerUrl")}
            label={t("Issuer URL")}
            description={
              defaults.issuerUrl
                ? t(
                    "Set by ALLOY_OIDC_ISSUER_URL. You can replace it here; to use the endpoints under Advanced instead, unset the variable.",
                  )
                : t(
                    "The provider's issuer or the full URL of its discovery document.",
                  )
            }
            type="url"
          />
          <TextField {...text("clientId")} label={t("Client ID")} />
          <ClientSecretField
            config={config.oidc}
            defaults={defaults}
            draft={draft}
            onChange={setField}
          />
          <CallbackUrlField
            id="oidc-callback-url"
            value={callbackURL(config.authBaseURL)}
          />
        </div>

        {draft.enabled && !secretAvailable(config.oidc, defaults, draft) ? (
          <Callout tone="info" className="text-xs">
            <InfoIcon />
            <span>
              {t("Sign-in stays off until the provider has a client secret.")}
            </span>
          </Callout>
        ) : null}

        <div className="border-border rounded-lg border">
          <Button
            type="button"
            variant="ghost"
            className="flex w-full justify-between rounded-lg px-3 py-2"
            onClick={() => setAdvancedOpen(!advancedOpen)}
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
            <div className="border-border grid gap-4 border-t p-3 md:grid-cols-2">
              <TextField
                {...text("authorizationUrl")}
                label={t("Authorization URL")}
                type="url"
              />
              <TextField
                {...text("tokenUrl")}
                label={t("Token URL")}
                type="url"
              />
              <TextField
                {...text("userInfoUrl")}
                label={t("User info URL")}
                type="url"
              />
              <TextField
                id="oidc-scopes"
                label={t("Scopes")}
                value={draft.scopes}
                placeholder={defaults.scopes.join(" ")}
                onChange={(scopes) => setField("scopes", scopes)}
                description={t("Separate scopes with spaces.")}
              />
              <div className="flex flex-col gap-1">
                <TokenAuthMethodField
                  id="oidc-token-auth"
                  value={draft.tokenAuthMethod}
                  onChange={(method) => setField("tokenAuthMethod", method)}
                />
                <p className="text-xs">
                  <AdminDefaultNote
                    value={draft.tokenAuthMethod}
                    defaultValue={defaults.tokenAuthMethod}
                    label={tokenAuthMethodLabel(defaults.tokenAuthMethod)}
                    onReset={() =>
                      setField("tokenAuthMethod", defaults.tokenAuthMethod)
                    }
                  />
                </p>
              </div>
              <ToggleField
                label={t("PKCE")}
                description={t(
                  "Secure the authorization flow with Proof Key for Code Exchange.",
                )}
                note={toggleNote("pkce")}
                checked={draft.pkce}
                onCheckedChange={(pkce) => setField("pkce", pkce)}
              />
              <ToggleField
                label={t("Fetch user info")}
                description={t(
                  "Read claims from the user info endpoint as well as the ID token.",
                )}
                note={toggleNote("fetchUserInfo")}
                checked={draft.fetchUserInfo}
                onCheckedChange={(fetchUserInfo) =>
                  setField("fetchUserInfo", fetchUserInfo)
                }
              />
              <TextField {...text("uidClaim")} label={t("UID claim")} />
              <TextField
                {...text("usernameClaim")}
                label={t("Username claim")}
              />
              <TextField {...text("avatarClaim")} label={t("Avatar claim")} />
              <TextField {...text("quotaClaim")} label={t("Quota claim")} />
              <TextField {...text("roleClaim")} label={t("Role claim")} />
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSubsection>
  )
}

function callbackURL(authBaseURL: string): string {
  const base = authBaseURL.endsWith("/")
    ? authBaseURL.slice(0, -1)
    : authBaseURL
  return `${base}/api/auth/oauth2/callback/${OIDC_PROVIDER_ID}`
}

function secretAvailable(
  config: AdminOidcConfig,
  defaults: AdminOidcConfig,
  draft: OidcDraft,
): boolean {
  if (draft.clientSecret.trim()) return true
  if (draft.dropSecret) return defaults.clientSecretSource !== null
  return config.clientSecretSource !== null
}

function ClientSecretField({
  config,
  defaults,
  draft,
  onChange,
}: {
  config: AdminOidcConfig
  defaults: AdminOidcConfig
  draft: OidcDraft
  onChange: SetDraftField
}) {
  const savedHere =
    config.clientSecretSource === "settings" && !draft.dropSecret
  const fromEnvironment =
    config.clientSecretSource === "environment" ||
    (draft.dropSecret && defaults.clientSecretSource === "environment")
  const placeholder = savedHere
    ? t("Unchanged")
    : fromEnvironment
      ? t("Set by ALLOY_OIDC_CLIENT_SECRET")
      : t("Not set")

  return (
    <div className="flex flex-col gap-1">
      <TextField
        id="oidc-client-secret"
        label={t("Client secret")}
        type="password"
        autoComplete="new-password"
        value={draft.clientSecret}
        placeholder={placeholder}
        onChange={(secret) => onChange("clientSecret", secret)}
      />
      {savedHere ? (
        <p className="text-xs">
          <button
            type="button"
            className="text-foreground-dim hover:text-foreground underline underline-offset-2"
            onClick={() => {
              onChange("clientSecret", "")
              onChange("dropSecret", true)
            }}
          >
            {defaults.clientSecretSource === "environment"
              ? t("Use the secret from the environment")
              : t("Remove the saved secret")}
          </button>
        </p>
      ) : null}
    </div>
  )
}
