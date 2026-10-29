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
import { SettingRows } from "@alloy/ui/components/setting-row"
import { useForm, useStore } from "@tanstack/react-form"
import { ChevronDownIcon, InfoIcon } from "lucide-react"
import { useState } from "react"
import type { ComponentProps } from "react"

import { useAdminConfigMutation } from "@/components/routes/settings/admin-config-context"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { api } from "@/lib/api"

import {
  CallbackUrlRow,
  TextRow,
  ToggleRow,
  TokenAuthMethodRow,
  tokenAuthMethodLabel,
} from "./admin-oidc-fields"
import { sameConfigValue } from "./admin-reset-default"

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

  const text = (key: TextFieldKey): ComponentProps<typeof TextRow> => ({
    id: `oidc-${key}`,
    title: "",
    value: draft[key],
    placeholder: defaults[key],
    onChange: (value) => setField(key, value),
  })

  return (
    <>
      <SettingsSubsection
        id="single-sign-on"
        title={t("Single sign-on")}
        description={t(
          "Sign in through an OpenID Connect provider. Empty fields use their default, shown as the placeholder.",
        )}
      >
        <SettingRows>
          <ToggleRow
            title={t("Enabled")}
            description={t("Show the sign-in button for this provider.")}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setField("enabled", enabled)}
          />
          <ToggleRow
            title={t("Create accounts")}
            description={t(
              "Give people an account on their first sign-in. When off, only accounts that are already linked can sign in.",
            )}
            checked={draft.allowSignUp}
            onCheckedChange={(allowSignUp) =>
              setField("allowSignUp", allowSignUp)
            }
          />
          <TextRow
            {...text("displayName")}
            title={t("Display name")}
            description={t("Shown on the button as Continue with {name}.", {
              name: draft.displayName.trim() || defaults.displayName,
            })}
            maxLength={64}
          />
          <TextRow
            {...text("issuerUrl")}
            title={t("Issuer URL")}
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
            wide
          />
          <TextRow {...text("clientId")} title={t("Client ID")} wide />
          <ClientSecretRow
            config={config.oidc}
            defaults={defaults}
            draft={draft}
            onChange={setField}
          />
          <CallbackUrlRow
            id="oidc-callback-url"
            value={callbackURL(config.authBaseURL)}
          />
        </SettingRows>
      </SettingsSubsection>

      <SettingsSubsection
        id="single-sign-on-advanced"
        title={t("Advanced")}
        description={t(
          "Endpoints are only needed when the provider has no discovery document. Claims name the profile fields Alloy reads.",
        )}
        action={
          <Button
            type="button"
            variant="secondary"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            {advancedOpen ? t("Hide") : t("Show")}
            <ChevronDownIcon
              className={
                advancedOpen
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </Button>
        }
      >
        {advancedOpen ? (
          <SettingRows>
            <TextRow
              {...text("authorizationUrl")}
              title={t("Authorization URL")}
              type="url"
              wide
            />
            <TextRow
              {...text("tokenUrl")}
              title={t("Token URL")}
              type="url"
              wide
            />
            <TextRow
              {...text("userInfoUrl")}
              title={t("User info URL")}
              type="url"
              wide
            />
            <TextRow
              id="oidc-scopes"
              title={t("Scopes")}
              description={t("Separate scopes with spaces.")}
              value={draft.scopes}
              placeholder={defaults.scopes.join(" ")}
              onChange={(scopes) => setField("scopes", scopes)}
            />
            <TokenAuthMethodRow
              id="oidc-token-auth"
              value={draft.tokenAuthMethod}
              reset={{
                value: draft.tokenAuthMethod,
                defaultValue: defaults.tokenAuthMethod,
                label: tokenAuthMethodLabel(defaults.tokenAuthMethod),
                onReset: () =>
                  setField("tokenAuthMethod", defaults.tokenAuthMethod),
              }}
              onChange={(method) => setField("tokenAuthMethod", method)}
            />
            <ToggleRow
              title={t("PKCE")}
              description={t(
                "Secure the authorization flow with Proof Key for Code Exchange.",
              )}
              checked={draft.pkce}
              onCheckedChange={(pkce) => setField("pkce", pkce)}
            />
            <ToggleRow
              title={t("Fetch user info")}
              description={t(
                "Read claims from the user info endpoint as well as the ID token.",
              )}
              checked={draft.fetchUserInfo}
              onCheckedChange={(fetchUserInfo) =>
                setField("fetchUserInfo", fetchUserInfo)
              }
            />
            <TextRow
              {...text("uidClaim")}
              title={t("UID claim")}
              description={t(
                "Identifies the account at the provider. Changing it breaks existing links.",
              )}
            />
            <TextRow
              {...text("usernameClaim")}
              title={t("Username claim")}
              description={t("Suggests the username for new accounts.")}
            />
            <TextRow
              {...text("avatarClaim")}
              title={t("Avatar claim")}
              description={t("Profile picture URL, synced on every sign-in.")}
            />
            <TextRow
              {...text("quotaClaim")}
              title={t("Quota claim")}
              description={t("Storage quota in GiB for new accounts.")}
            />
            <TextRow
              {...text("roleClaim")}
              title={t("Role claim")}
              description={t(
                "Sets the role to admin or user on every sign-in.",
              )}
            />
          </SettingRows>
        ) : null}
      </SettingsSubsection>
    </>
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

function ClientSecretRow({
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
    <TextRow
      id="oidc-client-secret"
      title={t("Client secret")}
      description={
        savedHere ? (
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
        ) : undefined
      }
      footer={
        draft.enabled && !secretAvailable(config, defaults, draft) ? (
          <Callout tone="info" className="text-xs">
            <InfoIcon />
            <span>
              {t("Sign-in stays off until the provider has a client secret.")}
            </span>
          </Callout>
        ) : undefined
      }
      type="password"
      autoComplete="new-password"
      value={draft.clientSecret}
      placeholder={placeholder}
      onChange={(secret) => onChange("clientSecret", secret)}
      wide
    />
  )
}
