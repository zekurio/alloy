import {
  isDiscordWebhookUrl,
  isValidWebhookTemplate,
  type AdminRuntimeConfig,
  type WebhookTestTarget,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
} from "@alloy/ui/components/section"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@alloy/ui/components/tabs"
import { Textarea } from "@alloy/ui/components/textarea"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { SaveIcon, SendIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useSettingsSaveBar } from "@/components/routes/settings/settings-save-context"
import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

interface WebhooksForm {
  discordEnabled: boolean
  /** Draft URL; the stored URL is write-only and never echoed back. */
  discordUrl: string
  /** True once the admin edited the URL field (including clearing it). */
  discordUrlDirty: boolean
  genericEnabled: boolean
  genericUrl: string
  genericTemplate: string
}

function formFromConfig(
  webhooks: AdminRuntimeConfig["webhooks"],
): WebhooksForm {
  return {
    discordEnabled: webhooks.discord.enabled,
    discordUrl: "",
    discordUrlDirty: false,
    genericEnabled: webhooks.generic.enabled,
    genericUrl: webhooks.generic.url,
    genericTemplate: webhooks.generic.template,
  }
}

export function WebhooksSettingsContent({
  config,
}: {
  config: AdminRuntimeConfig
}) {
  const saved = config.webhooks
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<WebhookTestTarget>("discord")
  const [form, setForm] = useState<WebhooksForm>(() => formFromConfig(saved))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  // The saved config is the source of truth: reset the draft whenever the
  // server hands back a new one.
  useEffect(() => {
    setForm(formFromConfig(saved))
  }, [saved])

  const dirty =
    form.discordEnabled !== saved.discord.enabled ||
    form.discordUrlDirty ||
    form.genericEnabled !== saved.generic.enabled ||
    form.genericUrl !== saved.generic.url ||
    form.genericTemplate !== saved.generic.template

  const discordUrl = form.discordUrl.trim()
  const discordUrlMessage =
    discordUrl !== "" && !isDiscordWebhookUrl(discordUrl)
      ? t(
          "This doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/...).",
        )
      : form.discordEnabled &&
          (form.discordUrlDirty
            ? discordUrl === ""
            : !saved.discord.webhookUrlSet)
        ? t("A webhook URL is required to announce clips.")
        : null
  const templateMessage = useMemo(
    () =>
      form.genericTemplate !== "" &&
      !isValidWebhookTemplate(form.genericTemplate)
        ? t("The template must be valid JSON.")
        : null,
    [form.genericTemplate],
  )
  const genericUrlMessage =
    form.genericEnabled && form.genericUrl.trim() === ""
      ? t("A webhook URL is required to announce clips.")
      : null
  const valid = !discordUrlMessage && !templateMessage && !genericUrlMessage

  async function save() {
    if (saving || !dirty) return
    if (!valid) {
      const message = discordUrlMessage ?? genericUrlMessage ?? templateMessage
      if (message) toast.error(message)
      return
    }
    setSaving(true)
    try {
      const updated = await api.admin.updateWebhooksConfig({
        discord: {
          enabled: form.discordEnabled,
          ...(form.discordUrlDirty ? { webhookUrl: discordUrl } : {}),
        },
        generic: {
          enabled: form.genericEnabled,
          url: form.genericUrl.trim(),
          template: form.genericTemplate,
        },
      })
      queryClient.setQueryData(adminKeys.runtimeConfig(), updated)
      toast.success(t("Webhook settings saved"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't save webhook settings")))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(formFromConfig(saved))
  }

  async function sendTest(target: WebhookTestTarget) {
    if (testing) return
    setTesting(true)
    try {
      await api.admin.sendWebhookTest(target)
      toast.success(t("Test message sent"))
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't send the test message")))
    } finally {
      setTesting(false)
    }
  }

  const inSettingsDialog = useSettingsSaveBar({ dirty, saving, save, discard })

  return (
    <Section>
      <SectionContent className="flex flex-col gap-4 py-0">
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value === "generic" ? "generic" : "discord")
          }
        >
          <TabsList>
            <TabsTrigger value="discord">{t("Discord")}</TabsTrigger>
            <TabsTrigger value="generic">{t("Custom webhook")}</TabsTrigger>
          </TabsList>

          <TabsContent value="discord" className="flex flex-col">
            <p className="text-foreground-dim py-3 text-xs">
              {t(
                "Announce clips in a Discord channel when they become public. The message is removed again when a clip stops being public.",
              )}
            </p>
            <SettingRow
              title={t("Announce public clips")}
              description={t(
                "Post an embed for every clip that becomes public.",
              )}
            >
              <Switch
                checked={form.discordEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, discordEnabled: checked }))
                }
              />
            </SettingRow>
            <SettingRow
              title={t("Webhook URL")}
              description={t(
                "Create a webhook in your Discord channel settings and paste its URL. The URL contains a secret and is never shown again.",
              )}
              htmlFor="webhooks-discord-url"
              align="start"
            >
              <div className="flex w-72 max-w-full flex-col gap-1.5">
                <Input
                  id="webhooks-discord-url"
                  type="password"
                  value={form.discordUrl}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      discordUrl: event.target.value,
                      discordUrlDirty: true,
                    }))
                  }
                  placeholder={
                    saved.discord.webhookUrlSet
                      ? t("(unchanged)")
                      : "https://discord.com/api/webhooks/..."
                  }
                  autoComplete="off"
                  aria-invalid={discordUrlMessage ? true : undefined}
                />
                {discordUrlMessage ? (
                  <p className="text-destructive text-2xs">
                    {discordUrlMessage}
                  </p>
                ) : null}
              </div>
            </SettingRow>
            <TestWebhookRow
              target="discord"
              configured={saved.discord.webhookUrlSet}
              dirty={dirty}
              testing={testing}
              onSendTest={sendTest}
            />
          </TabsContent>

          <TabsContent value="generic" className="flex flex-col">
            <p className="text-foreground-dim py-3 text-xs">
              {t(
                "POST a JSON payload of your own shape to any endpoint when a clip becomes public.",
              )}
            </p>
            <SettingRow
              title={t("Announce public clips")}
              description={t(
                "Send the JSON template below for every clip that becomes public.",
              )}
            >
              <Switch
                checked={form.genericEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, genericEnabled: checked }))
                }
              />
            </SettingRow>
            <SettingRow
              title={t("Webhook URL")}
              description={t("Endpoint that receives the JSON POST.")}
              htmlFor="webhooks-generic-url"
              align="start"
            >
              <div className="flex w-72 max-w-full flex-col gap-1.5">
                <Input
                  id="webhooks-generic-url"
                  value={form.genericUrl}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      genericUrl: event.target.value,
                    }))
                  }
                  placeholder="https://example.com/hooks/alloy"
                  autoComplete="off"
                  aria-invalid={genericUrlMessage ? true : undefined}
                />
                {genericUrlMessage ? (
                  <p className="text-destructive text-2xs">
                    {genericUrlMessage}
                  </p>
                ) : null}
              </div>
            </SettingRow>
            <SettingRow
              title={t("JSON template")}
              description={t(
                "Placeholders: [clip_url], [title], [author], [game]. Values are escaped automatically.",
              )}
              htmlFor="webhooks-generic-template"
              align="start"
            >
              <div className="flex w-72 max-w-full flex-col gap-1.5">
                <Textarea
                  id="webhooks-generic-template"
                  value={form.genericTemplate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      genericTemplate: event.target.value,
                    }))
                  }
                  rows={5}
                  className="font-mono text-xs"
                  aria-invalid={templateMessage ? true : undefined}
                />
                {templateMessage ? (
                  <p className="text-destructive text-2xs">{templateMessage}</p>
                ) : null}
              </div>
            </SettingRow>
            <TestWebhookRow
              target="generic"
              configured={saved.generic.url !== ""}
              dirty={dirty}
              testing={testing}
              onSendTest={sendTest}
            />
          </TabsContent>
        </Tabs>
      </SectionContent>
      {!inSettingsDialog && (
        <SectionFooter>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={saving || !dirty}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              disabled={saving || !dirty || !valid}
            >
              <SaveIcon />
              {saving ? t("Saving...") : t("Save")}
            </Button>
          </div>
        </SectionFooter>
      )}
    </Section>
  )
}

// The test always runs against the *stored* config, so it stays disabled
// while the draft has unsaved changes or no endpoint has been saved yet.
function TestWebhookRow({
  target,
  configured,
  dirty,
  testing,
  onSendTest,
}: {
  target: WebhookTestTarget
  configured: boolean
  dirty: boolean
  testing: boolean
  onSendTest: (target: WebhookTestTarget) => Promise<void>
}) {
  return (
    <SettingRow
      title={t("Test webhook")}
      description={
        dirty
          ? t("Save your changes to send a test message")
          : t("Send a sample announcement to the saved endpoint.")
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void onSendTest(target)}
        disabled={testing || dirty || !configured}
      >
        {testing ? <Spinner className="size-3.5" /> : <SendIcon />}
        {t("Send test")}
      </Button>
    </SettingRow>
  )
}
