import type {
  AdminOAuthProvider,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
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
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { PencilIcon, PlusIcon, Trash2Icon, UserKeyIcon } from "lucide-react"
import { useState } from "react"
import type { FormEvent } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"

import { OAuthProviderForm } from "./admin-auth-provider-form"
import type { ProviderDraft } from "./admin-auth-provider-utils"
import {
  draftToInput,
  providerToDraft,
  providerToInput,
} from "./admin-auth-provider-utils"

export function OAuthProviderSettings({
  config,
  pending,
  onSave,
}: {
  config: AdminRuntimeConfig
  pending: boolean
  onSave: (providers: AdminOAuthProviderInput[]) => Promise<boolean>
}) {
  const readOnly = config.authLocks.oauthProviders
  return (
    <div className="border-border flex flex-col gap-4 border-t pt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">{t("OAuth providers")}</span>
          <p className="text-foreground-dim text-xs">
            {t("Configure external OIDC and OAuth sign-in providers.")}
          </p>
        </div>
        {readOnly ? null : (
          <div className="shrink-0">
            <ProviderDialog
              providers={config.oauthProviders}
              provider={null}
              providerIndex={null}
              authBaseURL={config.authBaseURL}
              pending={pending}
              onSave={onSave}
            />
          </div>
        )}
      </div>
      {readOnly ? <OAuthProvidersEnvNote /> : null}
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
                readOnly={readOnly}
                pending={pending}
                onSave={onSave}
              />
            </ListItem>
          ))}
        </List>
      )}
    </div>
  )
}

function OAuthProvidersEnvNote() {
  return (
    <span className="text-foreground-muted flex flex-wrap items-center gap-1 text-xs">
      {t("Managed by environment variable")}:{" "}
      <code className="bg-surface-raised text-foreground-dim rounded px-1 py-px font-mono text-[11px]">
        ALLOY_SOCIALACCOUNT_PROVIDERS
      </code>
    </span>
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
    await onSave(
      providers.map((current, index) =>
        index === providerIndex
          ? { ...providerToInput(current), enabled }
          : providerToInput(current),
      ),
    )
  }

  async function deleteProvider() {
    await onSave(
      providers
        .filter((_, index) => index !== providerIndex)
        .map(providerToInput),
    )
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
          <ProviderActions
            provider={provider}
            providerIndex={providerIndex}
            providers={providers}
            authBaseURL={authBaseURL}
            pending={pending}
            onDelete={deleteProvider}
            onSave={onSave}
          />
        )}
      </div>
    </>
  )
}

function ProviderActions({
  provider,
  providerIndex,
  providers,
  authBaseURL,
  pending,
  onDelete,
  onSave,
}: {
  provider: AdminOAuthProvider
  providerIndex: number
  providers: AdminOAuthProvider[]
  authBaseURL: string
  pending: boolean
  onDelete: () => Promise<void>
  onSave: (providers: AdminOAuthProviderInput[]) => Promise<boolean>
}) {
  return (
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
            <AlertDialogTitle>{t("Delete OAuth provider?")}</AlertDialogTitle>
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
              onClick={onDelete}
              disabled={pending}
            >
              {pending ? t("Deleting") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    if (!(await onSave(nextProviders))) return
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
            <OAuthProviderForm
              draft={draft}
              editingProviderId={provider?.providerId ?? null}
              clientSecretSet={provider?.clientSecretSet ?? false}
              authBaseURL={authBaseURL}
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpen}
              onChange={(next) =>
                setDraft((current) => ({ ...current, ...next }))
              }
            />
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
