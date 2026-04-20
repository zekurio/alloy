import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import {
  deleteOAuthProvider,
  saveOAuthProvider,
  type AdminOAuthProvider,
  type AdminRuntimeConfig,
  USERNAME_CLAIM_SUGGESTIONS,
} from "../../../lib/admin-api"
import { emptyProvider, emptyToUndefined } from "./shared"

type OAuthProviderCardProps = {
  provider: AdminOAuthProvider | null
  onChange: (next: AdminRuntimeConfig) => void
}

export function OAuthProviderCard({
  provider,
  onChange,
}: OAuthProviderCardProps) {
  const [form, setForm] = React.useState<AdminOAuthProvider>(
    provider ?? emptyProvider()
  )
  const [pending, setPending] = React.useState<"save" | "delete" | null>(null)

  function set<K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending("save")
    try {
      const next = await saveOAuthProvider({
        ...form,
        discoveryUrl: emptyToUndefined(form.discoveryUrl),
        authorizationUrl: emptyToUndefined(form.authorizationUrl),
        tokenUrl: emptyToUndefined(form.tokenUrl),
        userInfoUrl: emptyToUndefined(form.userInfoUrl),
      })
      onChange(next)
      toast.success("Provider saved")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't save provider"
      )
    } finally {
      setPending(null)
    }
  }

  async function onDelete() {
    if (pending || !provider) return
    setPending("delete")
    try {
      const next = await deleteOAuthProvider()
      onChange(next)
      setForm(emptyProvider())
      toast.success("Provider removed")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove provider"
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <form onSubmit={onSave}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>OAuth provider</CardTitle>
            <CardDescription>
              One OIDC/OAuth2 provider. Use discovery or manual endpoints.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oauth-provider-id">Provider ID</FieldLabel>
              <Input
                id="oauth-provider-id"
                value={form.providerId}
                placeholder="sso"
                pattern="^[a-z0-9-]+$"
                title="lowercase letters, digits, dashes"
                required
                onChange={(e) => set("providerId", e.target.value)}
              />
              <FieldDescription>URL-safe slug.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-button-text">Button label</FieldLabel>
              <Input
                id="oauth-button-text"
                value={form.buttonText}
                placeholder="Log in with Company SSO"
                required
                maxLength={128}
                onChange={(e) => set("buttonText", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oauth-client-id">Client ID</FieldLabel>
              <Input
                id="oauth-client-id"
                value={form.clientId}
                required
                onChange={(e) => set("clientId", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-client-secret">
                Client secret
              </FieldLabel>
              <Input
                id="oauth-client-secret"
                type="password"
                autoComplete="new-password"
                value={form.clientSecret}
                required={!provider}
                placeholder={
                  provider ? "Leave blank to keep current" : "Client secret"
                }
                onChange={(e) => set("clientSecret", e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="oauth-discovery">Discovery URL</FieldLabel>
            <Input
              id="oauth-discovery"
              type="url"
              value={form.discoveryUrl ?? ""}
              placeholder="https://sso.example.com/realms/main/.well-known/openid-configuration"
              onChange={(e) => set("discoveryUrl", e.target.value)}
            />
            <FieldDescription>
              Preferred for OIDC; otherwise fill endpoints below.
            </FieldDescription>
          </Field>

          {(() => {
            const manualEndpointsRequired = !emptyToUndefined(form.discoveryUrl)
            return (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="oauth-auth-url">
                    Authorization URL
                  </FieldLabel>
                  <Input
                    id="oauth-auth-url"
                    type="url"
                    value={form.authorizationUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("authorizationUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-token-url">Token URL</FieldLabel>
                  <Input
                    id="oauth-token-url"
                    type="url"
                    value={form.tokenUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("tokenUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-userinfo-url">
                    Userinfo URL
                  </FieldLabel>
                  <Input
                    id="oauth-userinfo-url"
                    type="url"
                    value={form.userInfoUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("userInfoUrl", e.target.value)}
                  />
                </Field>
              </div>
            )
          })()}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oauth-scopes">Scopes</FieldLabel>
              <Input
                id="oauth-scopes"
                value={(form.scopes ?? []).join(" ")}
                placeholder="openid profile email"
                onChange={(e) =>
                  set(
                    "scopes",
                    e.target.value
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-username-claim">
                Username claim
              </FieldLabel>
              <Input
                id="oauth-username-claim"
                list="oauth-username-claim-suggestions"
                value={form.usernameClaim ?? ""}
                placeholder="preferred_username"
                onChange={(e) => set("usernameClaim", e.target.value)}
              />
              <datalist id="oauth-username-claim-suggestions">
                {USERNAME_CLAIM_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <FieldDescription>
                Any claim on the OIDC userinfo response. Suggestions cover the
                common cases; type anything your provider emits.
              </FieldDescription>
            </Field>
          </div>
        </CardContent>

        <CardFooter>
          {provider ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={pending !== null}
            >
              <Trash2Icon className="size-4" />
              {pending === "delete" ? "Removing…" : "Remove provider"}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending !== null}
          >
            {pending === "save"
              ? "Saving…"
              : provider
                ? "Save changes"
                : "Save provider"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
