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
import { Button } from "@alloy/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import { List, ListItem } from "@alloy/ui/components/list"
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
import { Section, SectionContent } from "@alloy/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserKeyIcon,
} from "lucide-react"
import { useState } from "react"
import type { ComponentProps, FormEvent } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
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
    <Section>
      <SectionContent className="flex flex-col gap-6 py-0">
        <div className="flex flex-col">
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
        </div>

        <div className="border-border flex flex-col gap-4 border-t pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {t("OAuth providers")}
              </span>
              <p className="text-foreground-dim text-xs">
                {t("Configure external OIDC and OAuth sign-in providers.")}
              </p>
            </div>
            {config.authLocks.oauthProviders ? null : (
              <div className="shrink-0">
                <ProviderDialog
                  providers={config.oauthProviders}
                  provider={null}
                  providerIndex={null}
                  authBaseURL={config.authBaseURL}
                  pending={providerPending}
                  onSave={saveProviders}
                />
              </div>
            )}
          </div>
          {config.authLocks.oauthProviders ? (
            <EnvManagedNote
              envName="ALLOY_SOCIALACCOUNT_PROVIDERS"
              className="mt-0"
            />
          ) : null}
          {config.oauthProviders.length === 0 ? (
            <ListEmpty title={t("No OAuth providers configured")} />
          ) : (
            <List>
              {config.oauthProviders.map((provider, index) => (
                <ListItem key={provider.providerId}>
                  <ProviderRow
                    provider={provider}
                    providerIndex={index}
                    providers={config.oauthProviders}
                    authBaseURL={config.authBaseURL}
                    readOnly={config.authLocks.oauthProviders}
                    pending={providerPending}
                    onSave={saveProviders}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </div>
      </SectionContent>
    </Section>
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
    <SettingRow
      title={item.label}
      description={
        locked ? (
          <>
            {item.description}
            <EnvManagedNote envName={item.envName} />
          </>
        ) : (
          item.description
        )
      }
      align="start"
    >
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={locked || pending}
      />
    </SettingRow>
  )
}

function EnvManagedNote({
  envName,
  className,
}: {
  envName: string
  className?: string
}) {
  // Rendered as a span so it can live inside SettingRow's <p> description.
  return (
    <span
      className={cn(
        "text-foreground-muted mt-1 flex flex-wrap items-center gap-1 text-xs",
        className,
      )}
    >
      {t("Managed by environment variable")}:{" "}
      <code className="bg-surface-raised text-foreground-dim rounded px-1 py-px font-mono text-[11px]">
        {envName}
      </code>
    </span>
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

function ProviderRow({
  provider,
  providerIndex,
  providers,
  authBaseURL,
  readOnly,
  pending,
  onSave,
}: {
  provider: AdminOAuthProvider
  providerIndex: number
  providers: AdminOAuthProvider[]
  authBaseURL: string
  readOnly: boolean
  pending: boolean
  onSave: (providers: AdminOAuthProviderInput[]) => Promise<boolean>
}) {
  async function toggleEnabled(enabled: boolean) {
    const nextProviders = providers.map((current, index) =>
      index === providerIndex
        ? { ...providerToInput(current), enabled }
        : providerToInput(current),
    )
    await onSave(nextProviders)
  }

  async function deleteProvider() {
    const nextProviders = providers
      .filter((_, index) => index !== providerIndex)
      .map(providerToInput)
    await onSave(nextProviders)
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className="border-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border"
          style={{
            backgroundColor: provider.buttonColor,
            color: provider.buttonTextColor,
          }}
        >
          {provider.iconUrl ? (
            <img
              src={provider.iconUrl}
              alt=""
              className="size-4 object-contain"
            />
          ) : (
            <UserKeyIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {provider.displayName}
          </div>
          <p className="text-foreground-dim truncate font-mono text-xs">
            {provider.providerId}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={provider.enabled}
          disabled={readOnly || pending}
          onCheckedChange={(enabled) => void toggleEnabled(enabled)}
        />
        {readOnly ? null : (
          <>
            <ProviderDialog
              providers={providers}
              provider={provider}
              providerIndex={providerIndex}
              authBaseURL={authBaseURL}
              pending={pending}
              onSave={onSave}
            />
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Delete")}
                    disabled={pending}
                  >
                    <Trash2Icon />
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
          </>
        )}
      </div>
    </>
  )
}

function ProviderDialog({
  providers,
  provider,
  providerIndex,
  authBaseURL,
  pending,
  onSave,
}: {
  providers: AdminOAuthProvider[]
  provider: AdminOAuthProvider | null
  providerIndex: number | null
  authBaseURL: string
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
          editing ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Edit")}
              disabled={pending}
            >
              <PencilIcon />
            </Button>
          ) : (
            <Button type="button" size="sm" variant="primary">
              <PlusIcon />
              {t("Add provider")}
            </Button>
          )
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
              <CallbackUrlField
                id={
                  editing
                    ? `callback-url-${provider.providerId}`
                    : "new-callback-url"
                }
                value={callbackURLForProvider(authBaseURL, draft.providerId)}
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
              <ToggleField
                label={t("Enabled")}
                description={t("Allow users to sign in with this provider.")}
                checked={draft.enabled}
                onCheckedChange={(enabled) => changeDraft({ enabled })}
              />
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
                  <ToggleField
                    label={t("PKCE")}
                    description={t(
                      "Secure the authorization flow with Proof Key for Code Exchange.",
                    )}
                    checked={draft.pkce}
                    onCheckedChange={(pkce) => changeDraft({ pkce })}
                  />
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

function CallbackUrlField({ id, value }: { id: string; value: string }) {
  async function copyCallbackUrl() {
    const copied = await copyTextToClipboard(value, {
      action: "copy OAuth callback URL",
    })
    if (copied) {
      toast.success(t("Callback URL copied"))
    } else {
      toast.error(t("Couldn't copy callback URL"))
    }
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

function callbackURLForProvider(
  authBaseURL: string,
  providerId: string,
): string {
  const base = authBaseURL.endsWith("/")
    ? authBaseURL.slice(0, -1)
    : authBaseURL
  return `${base}/api/auth/oauth2/callback/${providerId.trim() || "{providerId}"}`
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
