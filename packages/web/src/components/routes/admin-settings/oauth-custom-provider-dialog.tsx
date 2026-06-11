import {
  type AdminOAuthProvider,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/api"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@alloy/ui/components/responsive-dialog"
import { Switch } from "@alloy/ui/components/switch"
import { PlusIcon, SaveIcon } from "lucide-react"
import * as React from "react"

import { LimitedInput } from "@/components/form/limited-field"

import { OAuthCallbackField } from "./oauth-provider-fields"
import { parseScopes, scopeInputValue } from "./oauth-provider-scopes"
import { callbackURLForProvider } from "./shared"

export function OAuthCustomProviderDialog({
  authBaseURL,
  draft,
  editing,
  canSubmit,
  pendingAction,
  onOpenChange,
  onSubmit,
  onChange,
}: {
  authBaseURL: string
  draft: AdminOAuthProvider | null
  editing: boolean
  canSubmit: boolean
  pendingAction: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onChange: <K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K],
  ) => void
}) {
  const [scopeText, setScopeText] = React.useState("")
  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    const isOpen = draft !== null
    if (isOpen && !wasOpenRef.current) {
      setScopeText(scopeInputValue(draft.scopes))
    }
    if (!isOpen) {
      setScopeText("")
    }
    wasOpenRef.current = isOpen
  }, [draft])

  return (
    <ResponsiveDialog open={draft !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        variant="secondary"
        className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editing ? "Edit OAuth provider" : "Add OAuth provider"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {draft ? (
          <form id="oauth-provider-form" onSubmit={onSubmit}>
            <ResponsiveDialogBody className="flex max-h-[calc(100dvh-11rem)] flex-col gap-4 overflow-y-scroll">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="oauth-display-name" required>
                    Display name
                  </FieldLabel>
                  <LimitedInput
                    id="oauth-display-name"
                    value={draft.displayName}
                    maxLength={64}
                    required
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("displayName", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-provider-id" required>
                    Provider ID
                  </FieldLabel>
                  <Input
                    id="oauth-provider-id"
                    value={draft.providerId}
                    required
                    pattern="^[a-z0-9-]+$"
                    title="lowercase letters, digits, dashes"
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("providerId", e.target.value)}
                  />
                </Field>
              </div>

              <OAuthCallbackField
                id="oauth-callback-url"
                label="Callback URL"
                value={callbackURLForProvider(authBaseURL, draft.providerId)}
              />

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                <Field>
                  <FieldLabel htmlFor="oauth-icon-url">Icon URL</FieldLabel>
                  <Input
                    id="oauth-icon-url"
                    type="url"
                    value={draft.iconUrl ?? ""}
                    placeholder="https://issuer/icon.svg"
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("iconUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-button-color">Button</FieldLabel>
                  <HexColorInput
                    id="oauth-button-color"
                    value={draft.buttonColor ?? ""}
                    fallback="#27272a"
                    disabled={pendingAction !== null}
                    onChange={(value) => onChange("buttonColor", value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-button-text-color">
                    Text
                  </FieldLabel>
                  <HexColorInput
                    id="oauth-button-text-color"
                    value={draft.buttonTextColor ?? ""}
                    fallback="#fafafa"
                    disabled={pendingAction !== null}
                    onChange={(value) => onChange("buttonTextColor", value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="oauth-client-id" required>
                    Client ID
                  </FieldLabel>
                  <Input
                    id="oauth-client-id"
                    value={draft.clientId}
                    required
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("clientId", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-client-secret">
                    Client secret
                  </FieldLabel>
                  <Input
                    id="oauth-client-secret"
                    type="password"
                    value={draft.clientSecret ?? ""}
                    placeholder={
                      draft.clientSecretSet
                        ? "Leave blank to keep current secret"
                        : ""
                    }
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("clientSecret", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="oauth-scopes">Scopes</FieldLabel>
                  <Input
                    id="oauth-scopes"
                    value={scopeText}
                    placeholder="openid profile email"
                    disabled={pendingAction !== null}
                    onChange={(e) => {
                      const next = e.target.value
                      setScopeText(next)
                      onChange("scopes", parseScopes(next))
                    }}
                    onBlur={() =>
                      setScopeText(scopeInputValue(parseScopes(scopeText)))
                    }
                  />
                  <FieldDescription>Space-separated.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-username-claim">
                    Username claim
                  </FieldLabel>
                  <Input
                    id="oauth-username-claim"
                    value={draft.usernameClaim ?? ""}
                    placeholder={OAUTH_USERNAME_CLAIM_DEFAULT}
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("usernameClaim", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-quota-claim">
                    Quota claim
                  </FieldLabel>
                  <Input
                    id="oauth-quota-claim"
                    value={draft.quotaClaim ?? ""}
                    placeholder={OAUTH_QUOTA_CLAIM_DEFAULT}
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("quotaClaim", e.target.value)}
                  />
                  <FieldDescription>
                    Claim value is interpreted as GiB. Defaults to{" "}
                    {OAUTH_QUOTA_CLAIM_DEFAULT}.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-role-claim">Role claim</FieldLabel>
                  <Input
                    id="oauth-role-claim"
                    value={draft.roleClaim ?? ""}
                    placeholder={OAUTH_ROLE_CLAIM_DEFAULT}
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("roleClaim", e.target.value)}
                  />
                  <FieldDescription>
                    Claim value can be user or admin. Defaults to{" "}
                    {OAUTH_ROLE_CLAIM_DEFAULT}.
                  </FieldDescription>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="oauth-discovery-url">
                    Discovery URL
                  </FieldLabel>
                  <Input
                    id="oauth-discovery-url"
                    value={draft.discoveryUrl ?? ""}
                    placeholder="https://issuer/.well-known/openid-configuration"
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("discoveryUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-authorization-url">
                    Authorization URL
                  </FieldLabel>
                  <Input
                    id="oauth-authorization-url"
                    value={draft.authorizationUrl ?? ""}
                    placeholder="https://issuer/oauth/authorize"
                    disabled={pendingAction !== null}
                    onChange={(e) =>
                      onChange("authorizationUrl", e.target.value)
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="oauth-token-url">Token URL</FieldLabel>
                  <Input
                    id="oauth-token-url"
                    value={draft.tokenUrl ?? ""}
                    placeholder="https://issuer/oauth/token"
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("tokenUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-userinfo-url">
                    User info URL
                  </FieldLabel>
                  <Input
                    id="oauth-userinfo-url"
                    value={draft.userInfoUrl ?? ""}
                    placeholder="https://issuer/oauth/userinfo"
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("userInfoUrl", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="border-border flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Enabled</div>
                    <p className="text-foreground-dim text-xs">
                      Show on the login page and allow sign-in.
                    </p>
                  </div>
                  <Switch
                    checked={draft.enabled}
                    disabled={pendingAction !== null}
                    onCheckedChange={(checked) => onChange("enabled", checked)}
                  />
                </label>

                <label className="border-border flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Use PKCE</div>
                    <p className="text-foreground-dim text-xs">
                      Keep this enabled unless the provider explicitly says
                      otherwise.
                    </p>
                  </div>
                  <Switch
                    checked={draft.pkce ?? true}
                    disabled={pendingAction !== null}
                    onCheckedChange={(checked) => onChange("pkce", checked)}
                  />
                </label>
              </div>
            </ResponsiveDialogBody>

            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pendingAction !== null}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pendingAction !== null || !canSubmit}
              >
                {editing ? (
                  <>
                    <SaveIcon />
                    Save
                  </>
                ) : (
                  <>
                    <PlusIcon />
                    Add provider
                  </>
                )}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function HexColorInput({
  id,
  value,
  fallback,
  disabled,
  onChange,
}: {
  id: string
  value: string
  fallback: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const pickerValue = hexPickerValue(value) ?? fallback
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        inputMode="text"
        pattern="^#?[0-9a-fA-F]{6}$"
        placeholder={fallback}
        title="Use a 6-digit hex color, for example #5865F2"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <Input
        type="color"
        value={pickerValue}
        className="w-12 shrink-0 px-1"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function hexPickerValue(value: string): string | null {
  const trimmed = value.trim()
  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : null
}
