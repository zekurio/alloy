import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Switch } from "@workspace/ui/components/switch"

import {
  type AdminOAuthProvider,
  USERNAME_CLAIM_SUGGESTIONS,
} from "@workspace/api"
import { LimitedInput } from "@/components/form/limited-field"
import {
  OAuthCallbackField,
  parseScopes,
  scopeInputValue,
} from "./oauth-provider-fields"
import { callbackURLForProvider } from "./shared"

export function OAuthCustomProviderDialog({
  authBaseURL,
  draft,
  editing,
  pendingAction,
  onOpenChange,
  onSubmit,
  onChange,
}: {
  authBaseURL: string
  draft: AdminOAuthProvider | null
  editing: boolean
  pendingAction: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onChange: <K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K]
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
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit OAuth provider" : "Add OAuth provider"}
          </DialogTitle>
          <DialogDescription>
            Technical admin surface. The callback URL is computed from the
            current provider ID.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <form id="oauth-provider-form" onSubmit={onSubmit}>
            <DialogBody className="flex flex-col gap-4">
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
                    value={draft.clientSecret}
                    placeholder={
                      editing ? "Leave blank to keep current secret" : ""
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
                  <FieldDescription>
                    Space-separated. Leave blank to use provider defaults.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-username-claim">
                    Username claim
                  </FieldLabel>
                  <NativeSelect
                    id="oauth-username-claim"
                    value={draft.usernameClaim ?? "preferred_username"}
                    disabled={pendingAction !== null}
                    onChange={(e) => onChange("usernameClaim", e.target.value)}
                  >
                    {USERNAME_CLAIM_SUGGESTIONS.map((claim) => (
                      <NativeSelectOption key={claim} value={claim}>
                        {claim}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
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
                <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Enabled</div>
                    <p className="text-xs text-foreground-dim">
                      Show on the login page and allow sign-in.
                    </p>
                  </div>
                  <Switch
                    checked={draft.enabled}
                    disabled={pendingAction !== null}
                    onCheckedChange={(checked) => onChange("enabled", checked)}
                  />
                </label>

                <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Use PKCE</div>
                    <p className="text-xs text-foreground-dim">
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
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pendingAction !== null}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pendingAction !== null}
              >
                {editing ? "Save changes" : "Add provider"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
