import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon, UserKeyIcon } from "lucide-react"

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
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { List, ListItem } from "@workspace/ui/components/list"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import type { AdminOAuthProvider, AdminRuntimeConfig } from "@workspace/api"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"
import { FormGroup } from "./form-group"
import { OAuthCustomProviderDialog } from "./oauth-custom-provider-dialog"
import {
  emptyProvider,
  oauthProvidersEqual,
  toSubmissionProvider,
} from "./shared"

type OAuthProviderCardProps = {
  config: AdminRuntimeConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

export function OAuthProviderCard({
  config,
  onChange,
  hideHeader,
}: OAuthProviderCardProps) {
  const [draft, setDraft] = React.useState<AdminOAuthProvider | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [editingProviderId, setEditingProviderId] = React.useState<
    string | null
  >(null)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const providers = config.oauthProviders

  async function persistProvider(
    nextProviders: AdminOAuthProvider[],
    successMessage: string,
  ) {
    setPendingAction(successMessage)
    try {
      const updated = await api.admin.saveOAuthConfig({
        oauthProviders: nextProviders,
      })
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      onChange(updated)
      toast.success(successMessage)
      return true
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't save OAuth settings"))
      return false
    } finally {
      setPendingAction(null)
    }
  }

  function openCreate() {
    setEditing(false)
    setEditingProviderId(null)
    setDraft(emptyProvider())
  }

  function openEditProvider(provider: AdminOAuthProvider) {
    setEditing(true)
    setEditingProviderId(provider.providerId)
    setDraft({ ...provider })
  }

  function closeDialog() {
    if (pendingAction) return
    setDraft(null)
    setEditing(false)
    setEditingProviderId(null)
  }

  async function toggleEnabled(providerId: string, enabled: boolean) {
    if (pendingAction) return
    await persistProvider(
      providers.map((provider) =>
        provider.providerId === providerId ? { ...provider, enabled } : provider
      ),
      enabled ? "Provider enabled" : "Provider disabled",
    )
  }

  async function removeProvider(providerId: string) {
    if (pendingAction) return
    await persistProvider(
      providers.filter((provider) => provider.providerId !== providerId),
      "Provider removed",
    )
  }

  async function saveProvider(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!draft || pendingAction) return
    const currentProvider = providers.find((provider) =>
      provider.providerId === editingProviderId
    )
    if (
      editing && currentProvider && oauthProvidersEqual(draft, currentProvider)
    ) {
      closeDialog()
      return
    }
    const submissionProvider = toSubmissionProvider(draft)
    const nextProviders = editing
      ? providers.map((provider) =>
        provider.providerId === editingProviderId
          ? submissionProvider
          : provider
      )
      : [...providers, submissionProvider]
    const ok = await persistProvider(
      nextProviders,
      editing ? "Provider updated" : "Provider added",
    )
    if (ok) closeDialog()
  }

  function setDraftField<K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const disabled = pendingAction !== null
  const currentProvider = draft
    ? providers.find((provider) => provider.providerId === editingProviderId)
    : undefined
  const providerChanged = !editing || !draft || !currentProvider ||
    !oauthProvidersEqual(draft, currentProvider)
  const enabledProviderCount = providers.filter((provider) => provider.enabled)
    .length

  return (
    <>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>OIDC / OAuth provider</SectionTitle>
          </SectionHeader>
        )}
        <SectionContent className="py-0">
          <FormGroup
            title="OAuth providers"
            description="Configure generic OIDC/OAuth2 providers."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={openCreate}
              >
                <PlusIcon />
                Add provider
              </Button>
            }
          >
            {providers.length > 0
              ? (
                <List>
                  {providers.map((provider) => (
                    <ListItem key={provider.providerId}>
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border"
                          style={{
                            backgroundColor: provider.buttonColor,
                            color: provider.buttonTextColor,
                          }}
                        >
                          {provider.iconUrl
                            ? (
                              <img
                                src={provider.iconUrl}
                                alt=""
                                className="size-4 object-contain"
                              />
                            )
                            : <UserKeyIcon className="size-4" />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {provider.displayName}
                          </div>
                          <p className="truncate text-xs text-foreground-dim">
                            {provider.providerId}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={provider.enabled}
                          disabled={disabled ||
                            (provider.enabled &&
                              enabledProviderCount <= 1 &&
                              !config.passkeyEnabled)}
                          onCheckedChange={(enabled) =>
                            void toggleEnabled(provider.providerId, enabled)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled}
                          onClick={() =>
                            openEditProvider(provider)}
                        >
                          <PencilIcon />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={disabled}
                              >
                                <Trash2Icon />
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader className="place-items-start text-left">
                              <AlertDialogTitle>
                                Remove OAuth provider?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This disables sign-in through{" "}
                                {provider.displayName}. You can add it back
                                later.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row justify-end">
                              <AlertDialogCancel disabled={disabled}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  removeProvider(provider.providerId)}
                                disabled={disabled}
                              >
                                {disabled ? "Removing…" : "Remove provider"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </ListItem>
                  ))}
                </List>
              )
              : (
                <p className="py-3 text-center text-sm text-foreground-dim">
                  No providers configured. Add one to get started.
                </p>
              )}
          </FormGroup>
        </SectionContent>
      </Section>

      <OAuthCustomProviderDialog
        authBaseURL={config.authBaseURL}
        draft={draft}
        editing={editing}
        canSubmit={providerChanged}
        pendingAction={pendingAction}
        onOpenChange={(open) => !open && closeDialog()}
        onSubmit={saveProvider}
        onChange={setDraftField}
      />
    </>
  )
}
