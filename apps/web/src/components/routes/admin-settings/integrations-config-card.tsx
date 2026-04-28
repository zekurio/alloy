import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Trash2Icon } from "lucide-react"

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
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/lib/toast"

import {
  INTEGRATIONS_REDACTED,
  type AdminIntegrationsConfig,
  type AdminRuntimeConfig,
} from "@workspace/api"

import { api } from "@/lib/api"
import { gameKeys } from "@/lib/game-queries"

type IntegrationsConfigCardProps = {
  integrations: AdminIntegrationsConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Called after a successful save (or when submitted with no changes). */
  onSaved?: () => void
  /** Hide the footer action buttons (Cancel / Save). */
  hideActions?: boolean
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
  /** HTML `id` for the `<form>` element, useful for external submit buttons. */
  formId?: string
}

function updateSteamGridDBStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  steamgriddbConfigured: boolean
) {
  queryClient.setQueryData(gameKeys.status(), { steamgriddbConfigured })
  void queryClient.invalidateQueries({ queryKey: gameKeys.status() })
}

export function IntegrationsConfigCard({
  integrations,
  onChange,
  onSaved,
  hideActions,
  hideHeader,
  formId,
}: IntegrationsConfigCardProps) {
  const queryClient = useQueryClient()
  const blankForm = (
    src: AdminIntegrationsConfig
  ): AdminIntegrationsConfig => ({
    ...src,
    steamgriddbApiKey:
      src.steamgriddbApiKey === INTEGRATIONS_REDACTED
        ? ""
        : src.steamgriddbApiKey,
  })

  const [form, setForm] = React.useState<AdminIntegrationsConfig>(() =>
    blankForm(integrations)
  )
  const [pending, setPending] = React.useState(false)
  const initialForm = React.useMemo(
    () => blankForm(integrations),
    [integrations]
  )

  React.useEffect(() => {
    setForm(initialForm)
  }, [initialForm])

  const steamgriddbConfigured =
    integrations.steamgriddbApiKey === INTEGRATIONS_REDACTED
  const isDirty = form.steamgriddbApiKey !== initialForm.steamgriddbApiKey

  function resetForm() {
    setForm(initialForm)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!isDirty) {
      onSaved?.()
      return
    }
    setPending(true)
    try {
      const patch: Partial<AdminIntegrationsConfig> = {}
      if (form.steamgriddbApiKey !== "") {
        patch.steamgriddbApiKey = form.steamgriddbApiKey
      }
      if (Object.keys(patch).length === 0) {
        toast.info("No changes to save")
        return
      }
      const next = await api.admin.updateIntegrationsConfig(patch)
      onChange(next)
      updateSteamGridDBStatus(queryClient, true)
      toast.success("Integrations updated")
      onSaved?.()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update integrations"
      )
    } finally {
      setPending(false)
    }
  }

  async function onClearSteamGridDB() {
    if (pending) return
    setPending(true)
    try {
      const next = await api.admin.updateIntegrationsConfig({
        steamgriddbApiKey: "",
      })
      onChange(next)
      updateSteamGridDBStatus(queryClient, false)
      toast.success("SteamGridDB key removed")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove key"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit}>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>SteamGridDB</SectionTitle>
          </SectionHeader>
        )}

        <fieldset disabled={pending} className="contents">
          <SectionContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="sgdb-api-key">API key</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="sgdb-api-key"
                  type="password"
                  className="pl-3.5"
                  autoComplete="new-password"
                  value={form.steamgriddbApiKey}
                  placeholder={
                    steamgriddbConfigured ? "Leave blank to keep current" : ""
                  }
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      steamgriddbApiKey: e.target.value,
                    }))
                  }
                />
                {steamgriddbConfigured ? (
                  <InputGroupAddon align="inline-end">
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <InputGroupButton
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-danger hover:text-danger"
                            aria-label="Remove SteamGridDB key"
                            title="Remove key"
                            disabled={pending || isDirty}
                          />
                        }
                      >
                        <Trash2Icon />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove SteamGridDB key?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This disables the game picker and cover art
                            integration until a new key is added.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={pending}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={onClearSteamGridDB}
                            disabled={pending}
                          >
                            {pending ? "Removing…" : "Remove key"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              <FieldDescription>
                {steamgriddbConfigured
                  ? "Configured. Type a new value to rotate."
                  : "Not configured — game picker is disabled."}
              </FieldDescription>
            </Field>
          </SectionContent>

          {!hideActions && (
            <SectionFooter className="justify-end">
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  className="flex-1 sm:flex-initial"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                  disabled={pending || !isDirty}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 sm:flex-initial"
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={pending || !isDirty}
                >
                  {pending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </SectionFooter>
          )}
        </fieldset>
      </Section>
    </form>
  )
}
