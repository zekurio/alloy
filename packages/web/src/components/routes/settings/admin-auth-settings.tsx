import type {
  AdminAuthConfigPatch,
  AdminOAuthProvider,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
  OAuthTokenAuthMethod,
} from "@alloy/api"
import {
  OAUTH_AVATAR_CLAIM_DEFAULT,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_QUOTA_CLAIM_DEFAULT,
  OAUTH_ROLE_CLAIM_DEFAULT,
  OAUTH_USERNAME_CLAIM_DEFAULT,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@alloy/ui/components/alert-dialog"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import type { ComponentProps, FormEvent } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

const TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const

type AuthToggleKey = keyof AdminAuthConfigPatch

type ProviderDraft = {
  providerId: string
  displayName: string
  clientId: string
  clientSecret: string
  discoveryUrl: string
  enabled: boolean
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scopes: string
  tokenAuthMethod: OAuthTokenAuthMethod
  pkce: boolean
  uidClaim: string
  usernameClaim: string
  avatarClaim: string
  quotaClaim: string
  roleClaim: string
  buttonColor: string
  buttonTextColor: string
  iconUrl: string
}

const AUTH_TOGGLES: {
  key: AuthToggleKey
  label: string
  description: string
  envName: string
}[] = [
  {
    key: "openRegistrations",
    label: t("Open registrations"),
    description: t("Allow new users to create accounts on this server."),
    envName: "ALLOY_OPEN_REGISTRATIONS",
  },
  {
    key: "passkeyEnabled",
    label: t("Passkeys"),
    description: t(
      "Enable password-free sign-in and registration with passkeys.",
    ),
    envName: "ALLOY_PASSKEY_ENABLED",
  },
  {
    key: "requireAuthToBrowse",
    label: t("Require sign-in to browse"),
    description: t(
      "Redirect signed-out visitors to login before they can browse.",
    ),
    envName: "ALLOY_REQUIRE_AUTH_TO_BROWSE",
  },
]

const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
  providerId: "",
  displayName: "",
  clientId: "",
  clientSecret: "",
  discoveryUrl: "",
  enabled: true,
  authorizationUrl: "",
  tokenUrl: "",
  userInfoUrl: "",
  scopes: "openid email profile",
  tokenAuthMethod: OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  pkce: true,
  uidClaim: "sub",
  usernameClaim: OAUTH_USERNAME_CLAIM_DEFAULT,
  avatarClaim: OAUTH_AVATAR_CLAIM_DEFAULT,
  quotaClaim: OAUTH_QUOTA_CLAIM_DEFAULT,
  roleClaim: OAUTH_ROLE_CLAIM_DEFAULT,
  buttonColor: "",
  buttonTextColor: "",
  iconUrl: "",
}

export function AuthSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const queryClient = useQueryClient()
  const [pendingToggle, setPendingToggle] = useState<AuthToggleKey | null>(null)
  const [providerPending, setProviderPending] = useState(false)

  async function updateToggle(key: AuthToggleKey, next: boolean) {
    if (pendingToggle) return
    setPendingToggle(key)
    try {
      const updated = await api.admin.updateAuthConfig({ [key]: next })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("Authentication setting saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't update authentication")))
    } finally {
      setPendingToggle(null)
    }
  }

  async function saveProviders(providers: AdminOAuthProviderInput[]) {
    if (providerPending) return false
    setProviderPending(true)
    try {
      const updated = await api.admin.updateOAuthProviders(providers)
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(t("OAuth providers saved"))
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save OAuth providers")))
      return false
    } finally {
      setProviderPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section>
        <SectionHeader>
          <div className="min-w-0">
            <SectionTitle>{t("Sign-in & access")}</SectionTitle>
            <p className="text-foreground-muted mt-1 text-sm">
              {t(
                "Control how users register, sign in, and browse this server.",
              )}
            </p>
          </div>
        </SectionHeader>
        <SectionContent className="flex flex-col gap-4">
          {AUTH_TOGGLES.map((item) => (
            <AuthToggleRow
              key={item.key}
              item={item}
              checked={config[item.key]}
              locked={config.authLocks[item.key]}
              pending={pendingToggle === item.key}
              onChange={(next) => updateToggle(item.key, next)}
            />
          ))}
        </SectionContent>
      </Section>

      <Section>
        <SectionHeader>
          <div className="min-w-0">
            <SectionTitle>{t("OAuth providers")}</SectionTitle>
            <p className="text-foreground-muted mt-1 text-sm">
              {t("Configure external OIDC and OAuth sign-in providers.")}
            </p>
            {config.authLocks.oauthProviders ? (
              <EnvManagedNote envName="ALLOY_SOCIALACCOUNT_PROVIDERS" />
            ) : null}
          </div>
          {config.authLocks.oauthProviders ? null : (
            <ProviderDialog
              providers={config.oauthProviders}
              provider={null}
              providerIndex={null}
              pending={providerPending}
              onSave={saveProviders}
            />
          )}
        </SectionHeader>
        <SectionContent className="flex flex-col gap-3">
          {config.oauthProviders.length === 0 ? (
            <p className="text-foreground-muted text-sm">
              {t("No OAuth providers configured.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {config.oauthProviders.map((provider, index) => (
                <ProviderRow
                  key={provider.providerId}
                  provider={provider}
                  providerIndex={index}
                  providers={config.oauthProviders}
                  readOnly={config.authLocks.oauthProviders}
                  pending={providerPending}
                  onSave={saveProviders}
                />
              ))}
            </div>
          )}
        </SectionContent>
      </Section>
    </div>
  )
}

function AuthToggleRow({
  item,
  checked,
  locked,
  pending,
  onChange,
}: {
  item: (typeof AUTH_TOGGLES)[number]
  checked: boolean
  locked: boolean
  pending: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="border-border/70 bg-surface-raised/30 flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{item.label}</div>
        <p className="text-foreground-dim mt-0.5 text-xs">{item.description}</p>
        {locked ? <EnvManagedNote envName={item.envName} /> : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={locked || pending}
        className="shrink-0"
      />
    </div>
  )
}

function EnvManagedNote({ envName }: { envName: string }) {
  return (
    <p className="text-foreground-muted mt-1 text-xs">
      {t("Managed by environment variable")}: {envName}
    </p>
  )
}

function ProviderRow({
  provider,
  providerIndex,
  providers,
  readOnly,
  pending,
  onSave,
}: {
  provider: AdminOAuthProvider
  providerIndex: number
  providers: AdminOAuthProvider[]
  readOnly: boolean
  pending: boolean
  onSave: (providers: AdminOAuthProviderInput[]) => Promise<boolean>
}) {
  async function deleteProvider() {
    const nextProviders = providers
      .filter((_, index) => index !== providerIndex)
      .map(providerToInput)
    await onSave(nextProviders)
  }

  return (
    <div className="border-border/70 bg-surface-raised/30 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-medium">
            {provider.displayName}
          </div>
          <Badge
            variant={provider.enabled ? "accent" : "secondary"}
            size="text"
          >
            {provider.enabled ? t("Enabled") : t("Disabled")}
          </Badge>
          <Badge
            variant={provider.clientSecretSet ? "default" : "outline"}
            size="text"
          >
            {provider.clientSecretSet ? t("Secret set") : t("No secret")}
          </Badge>
        </div>
        <p className="text-foreground-muted mt-1 font-mono text-xs">
          {provider.providerId}
        </p>
      </div>
      {readOnly ? null : (
        <div className="flex items-center gap-2 sm:shrink-0">
          <ProviderDialog
            providers={providers}
            provider={provider}
            providerIndex={providerIndex}
            pending={pending}
            onSave={onSave}
          />
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                >
                  <Trash2Icon />
                  {t("Delete")}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("Delete OAuth provider?")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Users may lose this sign-in method immediately.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  {t("Cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={deleteProvider}
                  disabled={pending}
                >
                  {pending ? t("Deleting") : t("Delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  )
}

function ProviderDialog({
  providers,
  provider,
  providerIndex,
  pending,
  onSave,
}: {
  providers: AdminOAuthProvider[]
  provider: AdminOAuthProvider | null
  providerIndex: number | null
  pending: boolean
  onSave: (providers: AdminOAuthProviderInput[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    providerToDraft(provider),
  )
  const editing = provider !== null && providerIndex !== null

  function changeDraft(next: Partial<ProviderDraft>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  function resetDraft() {
    setDraft(providerToDraft(provider))
    setAdvancedOpen(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const providerInput = draftToInput(draft)
    const nextProviders = editing
      ? providers.map((current, index) =>
          index === providerIndex ? providerInput : providerToInput(current),
        )
      : [...providers.map(providerToInput), providerInput]
    const saved = await onSave(nextProviders)
    if (!saved) return
    setOpen(false)
    resetDraft()
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) return
        resetDraft()
      }}
    >
      <ResponsiveDialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={editing ? "outline" : "primary"}
          >
            {editing ? <PencilIcon /> : <PlusIcon />}
            {editing ? t("Edit") : t("Add provider")}
          </Button>
        }
      />
      <ResponsiveDialogContent className="md:max-w-[760px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editing ? t("Edit OAuth provider") : t("Add OAuth provider")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("Provider secrets are write-only and never shown after saving.")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4 md:max-h-[70vh] md:overflow-y-auto">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id={
                  editing
                    ? `provider-id-${provider.providerId}`
                    : "new-provider-id"
                }
                label={t("Provider ID")}
                value={draft.providerId}
                onChange={(value) => changeDraft({ providerId: value })}
                maxLength={64}
                pattern="[a-z0-9-]+"
                required
                disabled={editing}
                description={t("Lowercase letters, numbers, and hyphens only.")}
              />
              <TextField
                id={
                  editing
                    ? `provider-name-${provider.providerId}`
                    : "new-provider-name"
                }
                label={t("Display name")}
                value={draft.displayName}
                onChange={(value) => changeDraft({ displayName: value })}
                maxLength={64}
                required
              />
              <TextField
                id={
                  editing ? `client-id-${provider.providerId}` : "new-client-id"
                }
                label={t("Client ID")}
                value={draft.clientId}
                onChange={(value) => changeDraft({ clientId: value })}
                required
              />
              <TextField
                id={
                  editing
                    ? `client-secret-${provider.providerId}`
                    : "new-client-secret"
                }
                label={t("Client secret")}
                value={draft.clientSecret}
                onChange={(value) => changeDraft({ clientSecret: value })}
                type="password"
                placeholder={
                  editing && provider.clientSecretSet
                    ? t("Unchanged")
                    : undefined
                }
                required={!editing && !provider?.clientSecretSet}
              />
              <TextField
                id={
                  editing
                    ? `discovery-url-${provider.providerId}`
                    : "new-discovery-url"
                }
                label={t("Discovery URL")}
                value={draft.discoveryUrl}
                onChange={(value) => changeDraft({ discoveryUrl: value })}
                type="url"
              />
              <div className="border-border/70 flex items-center justify-between gap-4 self-end rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t("Enabled")}</div>
                  <p className="text-foreground-dim mt-0.5 text-xs">
                    {t("Allow users to sign in with this provider.")}
                  </p>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => changeDraft({ enabled })}
                  className="shrink-0"
                />
              </div>
            </div>

            <div className="border-border/70 rounded-lg border">
              <Button
                type="button"
                variant="ghost"
                className="flex w-full justify-between rounded-lg px-3 py-2"
                onClick={() => setAdvancedOpen((current) => !current)}
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
                <div className="border-border/70 grid gap-4 border-t p-3 md:grid-cols-2">
                  <TextField
                    id={
                      editing
                        ? `authorization-url-${provider.providerId}`
                        : "new-authorization-url"
                    }
                    label={t("Authorization URL")}
                    value={draft.authorizationUrl}
                    onChange={(value) =>
                      changeDraft({ authorizationUrl: value })
                    }
                    type="url"
                  />
                  <TextField
                    id={
                      editing
                        ? `token-url-${provider.providerId}`
                        : "new-token-url"
                    }
                    label={t("Token URL")}
                    value={draft.tokenUrl}
                    onChange={(value) => changeDraft({ tokenUrl: value })}
                    type="url"
                  />
                  <TextField
                    id={
                      editing
                        ? `user-info-url-${provider.providerId}`
                        : "new-user-info-url"
                    }
                    label={t("User info URL")}
                    value={draft.userInfoUrl}
                    onChange={(value) => changeDraft({ userInfoUrl: value })}
                    type="url"
                  />
                  <TextField
                    id={
                      editing ? `scopes-${provider.providerId}` : "new-scopes"
                    }
                    label={t("Scopes")}
                    value={draft.scopes}
                    onChange={(value) => changeDraft({ scopes: value })}
                    description={t("Separate scopes with spaces.")}
                  />
                  <Field>
                    <FieldLabel
                      htmlFor={
                        editing
                          ? `token-auth-${provider.providerId}`
                          : "new-token-auth"
                      }
                    >
                      {t("Token auth method")}
                    </FieldLabel>
                    <Select
                      value={draft.tokenAuthMethod}
                      onValueChange={(value) => {
                        const method = TOKEN_AUTH_METHODS.find(
                          (option) => option === value,
                        )
                        if (method) changeDraft({ tokenAuthMethod: method })
                      }}
                    >
                      <SelectTrigger
                        id={
                          editing
                            ? `token-auth-${provider.providerId}`
                            : "new-token-auth"
                        }
                      >
                        <SelectValue>
                          {tokenAuthMethodLabel(draft.tokenAuthMethod)}
                        </SelectValue>
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
                  <div className="border-border/70 flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t("PKCE")}</div>
                      <p className="text-foreground-dim mt-0.5 text-xs">
                        {t("Use proof key for code exchange when supported.")}
                      </p>
                    </div>
                    <Switch
                      checked={draft.pkce}
                      onCheckedChange={(pkce) => changeDraft({ pkce })}
                      className="shrink-0"
                    />
                  </div>
                  <TextField
                    id={
                      editing
                        ? `uid-claim-${provider.providerId}`
                        : "new-uid-claim"
                    }
                    label={t("UID claim")}
                    value={draft.uidClaim}
                    onChange={(value) => changeDraft({ uidClaim: value })}
                  />
                  <TextField
                    id={
                      editing
                        ? `username-claim-${provider.providerId}`
                        : "new-username-claim"
                    }
                    label={t("Username claim")}
                    value={draft.usernameClaim}
                    onChange={(value) => changeDraft({ usernameClaim: value })}
                  />
                  <TextField
                    id={
                      editing
                        ? `avatar-claim-${provider.providerId}`
                        : "new-avatar-claim"
                    }
                    label={t("Avatar claim")}
                    value={draft.avatarClaim}
                    onChange={(value) => changeDraft({ avatarClaim: value })}
                  />
                  <TextField
                    id={
                      editing
                        ? `quota-claim-${provider.providerId}`
                        : "new-quota-claim"
                    }
                    label={t("Quota claim")}
                    value={draft.quotaClaim}
                    onChange={(value) => changeDraft({ quotaClaim: value })}
                  />
                  <TextField
                    id={
                      editing
                        ? `role-claim-${provider.providerId}`
                        : "new-role-claim"
                    }
                    label={t("Role claim")}
                    value={draft.roleClaim}
                    onChange={(value) => changeDraft({ roleClaim: value })}
                  />
                  <TextField
                    id={
                      editing
                        ? `button-color-${provider.providerId}`
                        : "new-button-color"
                    }
                    label={t("Button color")}
                    value={draft.buttonColor}
                    onChange={(value) => changeDraft({ buttonColor: value })}
                    placeholder="#5865F2"
                    pattern="#[0-9a-fA-F]{6}"
                  />
                  <TextField
                    id={
                      editing
                        ? `button-text-color-${provider.providerId}`
                        : "new-button-text-color"
                    }
                    label={t("Button text color")}
                    value={draft.buttonTextColor}
                    onChange={(value) =>
                      changeDraft({ buttonTextColor: value })
                    }
                    placeholder="#ffffff"
                    pattern="#[0-9a-fA-F]{6}"
                  />
                  <TextField
                    id={
                      editing
                        ? `icon-url-${provider.providerId}`
                        : "new-icon-url"
                    }
                    label={t("Icon URL")}
                    value={draft.iconUrl}
                    onChange={(value) => changeDraft({ iconUrl: value })}
                    type="url"
                  />
                </div>
              ) : null}
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button type="button" variant="ghost" disabled={pending}>
                  {t("Cancel")}
                </Button>
              }
            />
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="size-3.5" /> : null}
              {pending ? t("Saving...") : t("Save")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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

function tokenAuthMethodLabel(method: OAuthTokenAuthMethod) {
  if (method === OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD) {
    return t("Client secret basic")
  }
  return t("Client secret post")
}

function providerToDraft(provider: AdminOAuthProvider | null): ProviderDraft {
  if (!provider) return EMPTY_PROVIDER_DRAFT
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    clientId: provider.clientId,
    clientSecret: "",
    discoveryUrl: provider.discoveryUrl ?? "",
    enabled: provider.enabled,
    authorizationUrl: provider.authorizationUrl ?? "",
    tokenUrl: provider.tokenUrl ?? "",
    userInfoUrl: provider.userInfoUrl ?? "",
    scopes: provider.scopes?.join(" ") ?? "",
    tokenAuthMethod:
      provider.tokenAuthMethod ?? OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
    pkce: provider.pkce ?? true,
    uidClaim: provider.uidClaim ?? "sub",
    usernameClaim: provider.usernameClaim ?? OAUTH_USERNAME_CLAIM_DEFAULT,
    avatarClaim: provider.avatarClaim ?? OAUTH_AVATAR_CLAIM_DEFAULT,
    quotaClaim: provider.quotaClaim ?? OAUTH_QUOTA_CLAIM_DEFAULT,
    roleClaim: provider.roleClaim ?? OAUTH_ROLE_CLAIM_DEFAULT,
    buttonColor: provider.buttonColor ?? "",
    buttonTextColor: provider.buttonTextColor ?? "",
    iconUrl: provider.iconUrl ?? "",
  }
}

function providerToInput(
  provider: AdminOAuthProvider,
): AdminOAuthProviderInput {
  return compactProviderInput({
    providerId: provider.providerId,
    displayName: provider.displayName,
    clientId: provider.clientId,
    enabled: provider.enabled,
    discoveryUrl: provider.discoveryUrl,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
    scopes: provider.scopes,
    tokenAuthMethod: provider.tokenAuthMethod,
    pkce: provider.pkce,
    uidClaim: provider.uidClaim,
    usernameClaim: provider.usernameClaim,
    avatarClaim: provider.avatarClaim,
    quotaClaim: provider.quotaClaim,
    roleClaim: provider.roleClaim,
    buttonColor: provider.buttonColor,
    buttonTextColor: provider.buttonTextColor,
    iconUrl: provider.iconUrl,
  })
}

function draftToInput(draft: ProviderDraft): AdminOAuthProviderInput {
  return compactProviderInput({
    providerId: draft.providerId.trim(),
    displayName: draft.displayName.trim(),
    clientId: draft.clientId.trim(),
    enabled: draft.enabled,
    clientSecret: draft.clientSecret.trim(),
    discoveryUrl: draft.discoveryUrl.trim(),
    authorizationUrl: draft.authorizationUrl.trim(),
    tokenUrl: draft.tokenUrl.trim(),
    userInfoUrl: draft.userInfoUrl.trim(),
    scopes: draft.scopes.trim().split(/\s+/).filter(Boolean),
    tokenAuthMethod: draft.tokenAuthMethod,
    pkce: draft.pkce,
    uidClaim: draft.uidClaim.trim(),
    usernameClaim: draft.usernameClaim.trim(),
    avatarClaim: draft.avatarClaim.trim(),
    quotaClaim: draft.quotaClaim.trim(),
    roleClaim: draft.roleClaim.trim(),
    buttonColor: draft.buttonColor.trim(),
    buttonTextColor: draft.buttonTextColor.trim(),
    iconUrl: draft.iconUrl.trim(),
  })
}

function compactProviderInput(
  provider: AdminOAuthProviderInput,
): AdminOAuthProviderInput {
  const optionalStringKeys: (keyof AdminOAuthProviderInput)[] = [
    "clientSecret",
    "discoveryUrl",
    "authorizationUrl",
    "tokenUrl",
    "userInfoUrl",
    "uidClaim",
    "usernameClaim",
    "avatarClaim",
    "quotaClaim",
    "roleClaim",
    "buttonColor",
    "buttonTextColor",
    "iconUrl",
  ]
  const next = { ...provider }
  for (const key of optionalStringKeys) {
    if (typeof next[key] === "string" && next[key].trim().length === 0) {
      delete next[key]
    }
  }
  if (next.scopes?.length === 0) delete next.scopes
  return next
}
