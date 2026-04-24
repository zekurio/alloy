import * as React from "react"
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
import { toast } from "@workspace/ui/components/sonner"

import {
  INTEGRATIONS_REDACTED,
  type AdminIntegrationsConfig,
  type AdminRuntimeConfig,
} from "@workspace/api"

import { api } from "@/lib/api"

type IntegrationsConfigCardProps = {
  integrations: AdminIntegrationsConfig
  onChange: (next: AdminRuntimeConfig) => void
}

export function IntegrationsConfigCard({
  integrations,
  onChange,
}: IntegrationsConfigCardProps) {
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
      toast.success("Integrations updated")
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
    <form onSubmit={onSubmit}>
      <Section>
        <SectionHeader>
          <SectionTitle>SteamGridDB</SectionTitle>
        </SectionHeader>

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

          <SectionFooter className="justify-end">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetForm}
                disabled={pending || !isDirty}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending || !isDirty}
              >
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </SectionFooter>
        </fieldset>
      </Section>
    </form>
  )
}
