import type {
  AdminOAuthProvider,
  AdminOAuthProviderInput,
  AdminRuntimeConfig,
} from "@alloy/api"
import { publicOAuthProviderIconUrl } from "@alloy/api"
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
import { Callout } from "@alloy/ui/components/callout"
import { List, ListItem, ListItemButton } from "@alloy/ui/components/list"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@alloy/ui/components/responsive-dialog"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { cn } from "@alloy/ui/lib/utils"
import {
  CircleAlertIcon,
  PlusIcon,
  Trash2Icon,
  UserKeyIcon,
} from "lucide-react"
import { useState } from "react"
import type { FormEvent, ReactElement } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import { EnvManagedNote } from "@/components/routes/settings/admin-env-note"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

import { OAuthProviderForm } from "./admin-auth-provider-form"
import type {
  ProviderDraft,
  ProviderIconUpload,
} from "./admin-auth-provider-utils"
import {
  draftToInput,
  providerToDraft,
  providerToInput,
} from "./admin-auth-provider-utils"

type SaveProviders = (
  providers: AdminOAuthProviderInput[],
  iconUpload?: ProviderIconUpload,
) => Promise<boolean>

export function OAuthProviderSettings({
  config,
  pending,
  error,
  onSave,
}: {
  config: AdminRuntimeConfig
  pending: boolean
  error: string | null
  onSave: SaveProviders
}) {
  const readOnly = config.authLocks.oauthProviders
  return (
    <SettingsSubsection
      id="oauth-providers"
      title={t("OAuth providers")}
      description={t("Configure external OIDC and OAuth sign-in providers.")}
      action={
        readOnly ? null : (
          <AddProviderDialog
            providers={config.oauthProviders}
            authBaseURL={config.authBaseURL}
            pending={pending}
            error={error}
            onSave={onSave}
          />
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <Callout tone="destructive" className="text-xs">
            <CircleAlertIcon />
            <span>{error}</span>
          </Callout>
        ) : null}
        {readOnly ? <OAuthProvidersEnvNote /> : null}
        {config.oauthProviders.length === 0 ? (
          <ListEmpty title={t("No OAuth providers configured")} />
        ) : (
          <List>
            {config.oauthProviders.map((provider, index) => (
              <ProviderRow
                key={provider.providerId}
                provider={provider}
                providerIndex={index}
                providers={config.oauthProviders}
                authBaseURL={config.authBaseURL}
                readOnly={readOnly}
                pending={pending}
                error={error}
                onSave={onSave}
              />
            ))}
          </List>
        )}
      </div>
    </SettingsSubsection>
  )
}

function OAuthProvidersEnvNote() {
  return (
    <EnvManagedNote envName="ALLOY_SOCIALACCOUNT_PROVIDERS" className="mt-0" />
  )
}

function ProviderRow({
  provider,
  providerIndex,
  providers,
  authBaseURL,
  readOnly,
  pending,
  error,
  onSave,
}: {
  provider: AdminOAuthProvider
  providerIndex: number
  providers: AdminOAuthProvider[]
  authBaseURL: string
  readOnly: boolean
  pending: boolean
  error: string | null
  onSave: SaveProviders
}) {
  const [editing, setEditing] = useState(false)

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

  // Same filter the server applies to login buttons: only same-origin managed
  // paths render; external URLs never load in the browser.
  const iconUrl = publicOAuthProviderIconUrl(provider.iconUrl)

  const summary = (
    <>
      <span
        className="border-border inline-flex size-9 shrink-0 items-center justify-center rounded-md border"
        style={{
          backgroundColor: provider.buttonColor,
          color: provider.buttonTextColor,
        }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-4.5 object-contain" />
        ) : (
          <UserKeyIcon className="size-4.5" />
        )}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          !provider.enabled && "opacity-60",
        )}
      >
        <span className="text-md truncate font-semibold sm:text-base">
          {provider.displayName}
        </span>
        <span className="text-foreground-dim truncate font-mono text-sm sm:text-xs">
          {provider.providerId}
        </span>
      </span>
    </>
  )

  const enabledSwitch = (className?: string) => (
    <Switch
      className={className}
      checked={provider.enabled}
      disabled={readOnly || pending}
      onCheckedChange={(enabled) => void toggleEnabled(enabled)}
      aria-label={t("Enabled")}
    />
  )

  // Providers set through the environment can be read here, not changed.
  if (readOnly) {
    return (
      <ListItem>
        {summary}
        {enabledSwitch()}
      </ListItem>
    )
  }

  return (
    <>
      <ListItemButton
        onClick={() => setEditing(true)}
        actions={
          <>
            {enabledSwitch("mr-1.5")}
            <DeleteProviderButton
              pending={pending}
              error={error}
              onDelete={deleteProvider}
            />
          </>
        }
      >
        {summary}
      </ListItemButton>
      <ProviderDialog
        open={editing}
        onOpenChange={setEditing}
        providers={providers}
        provider={provider}
        providerIndex={providerIndex}
        authBaseURL={authBaseURL}
        pending={pending}
        error={error}
        onSave={onSave}
      />
    </>
  )
}

function DeleteProviderButton({
  pending,
  error,
  onDelete,
}: {
  pending: boolean
  error: string | null
  onDelete: () => Promise<void>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Delete provider")}
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
            {t(
              "This immediately deletes every linked account for this provider. Users will need to link the provider again if it is added back.",
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Callout tone="destructive" className="text-xs">
            <CircleAlertIcon />
            <span>{error}</span>
          </Callout>
        ) : null}
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
  )
}

function AddProviderDialog({
  providers,
  authBaseURL,
  pending,
  error,
  onSave,
}: {
  providers: AdminOAuthProvider[]
  authBaseURL: string
  pending: boolean
  error: string | null
  onSave: SaveProviders
}) {
  const [open, setOpen] = useState(false)
  return (
    <ProviderDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button">
          <PlusIcon />
          {t("Add provider")}
        </Button>
      }
      providers={providers}
      provider={null}
      providerIndex={null}
      authBaseURL={authBaseURL}
      pending={pending}
      error={error}
      onSave={onSave}
    />
  )
}

function ProviderDialog({
  open,
  onOpenChange,
  trigger,
  providers,
  provider,
  providerIndex,
  authBaseURL,
  pending,
  error,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit when the opener lives elsewhere and drives `open` itself. */
  trigger?: ReactElement
  providers: AdminOAuthProvider[]
  provider: AdminOAuthProvider | null
  providerIndex: number | null
  authBaseURL: string
  pending: boolean
  error: string | null
  onSave: SaveProviders
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    providerToDraft(provider),
  )
  const [draftOpen, setDraftOpen] = useState(open)
  const editing = provider !== null && providerIndex !== null

  // Start every opening from the provider as it is now. Resetting after a
  // save instead would use the pre-save provider captured by that render.
  if (open !== draftOpen) {
    setDraftOpen(open)
    if (open) {
      setDraft(providerToDraft(provider))
      setAdvancedOpen(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const providerInput = draftToInput(draft)
    const nextProviders = editing
      ? providers.map((current, index) =>
          index === providerIndex ? providerInput : providerToInput(current),
        )
      : [...providers.map(providerToInput), providerInput]
    const iconUpload = draft.iconFile
      ? { providerId: providerInput.providerId, file: draft.iconFile }
      : undefined
    if (!(await onSave(nextProviders, iconUpload))) return
    onOpenChange(false)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <ResponsiveDialogTrigger render={trigger} /> : null}
      <ResponsiveDialogContent className="md:max-w-[760px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editing ? t("Edit OAuth provider") : t("Add OAuth provider")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4 md:my-3 md:max-h-[70vh] md:overflow-y-auto md:py-1">
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
            {error ? (
              <Callout tone="destructive" className="text-xs">
                <CircleAlertIcon />
                <span>{error}</span>
              </Callout>
            ) : null}
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
