import type { OAuthTokenAuthMethod } from "@alloy/api"
import {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Field, FieldDescription, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Switch } from "@alloy/ui/components/switch"
import { CopyIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { copyTextToClipboard } from "@/lib/clipboard"
import { useActionFeedback } from "@/lib/use-action-feedback"

const TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const

export function ProviderTextField({
  fieldId,
  editingProviderId,
  ...props
}: {
  fieldId: string
  editingProviderId: string | null
} & Omit<ComponentProps<typeof TextField>, "id">) {
  return (
    <TextField id={providerFieldId(fieldId, editingProviderId)} {...props} />
  )
}

function TextField({
  id,
  label,
  description,
  value,
  onChange,
  className,
  ...props
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  /** Wrapper class, for grid placement. */
  className?: string
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "value" | "onChange" | "className"
>) {
  return (
    <Field className={className}>
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

export function TokenAuthMethodField({
  id,
  value,
  onChange,
}: {
  id: string
  value: OAuthTokenAuthMethod
  onChange: (value: OAuthTokenAuthMethod) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("Token auth method")}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          const method = TOKEN_AUTH_METHODS.find((option) => option === next)
          if (method) onChange(method)
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue>{tokenAuthMethodLabel(value)}</SelectValue>
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
  )
}

export function ToggleField({
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

export function CallbackUrlField({ id, value }: { id: string; value: string }) {
  const copyFeedback = useActionFeedback()
  async function copyCallbackUrl() {
    await copyFeedback.run(async () => {
      if (
        !(await copyTextToClipboard(value, {
          action: "copy OAuth callback URL",
        }))
      ) {
        throw new Error(t("Couldn't copy callback URL"))
      }
    }, t("Couldn't copy callback URL"))
  }

  return (
    <Field className="md:col-span-2">
      <FieldLabel htmlFor={id}>{t("Callback URL")}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="font-mono" />
        <FeedbackButton
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("Copy callback URL")}
          state={copyFeedback.feedback.state}
          pendingLabel={<span className="sr-only">{t("Copying…")}</span>}
          successLabel={<span className="sr-only">{t("Copied")}</span>}
          errorLabel={<span className="sr-only">{t("Try again")}</span>}
          title={
            copyFeedback.feedback.state === "error"
              ? copyFeedback.feedback.message
              : undefined
          }
          onClick={() => void copyCallbackUrl()}
        >
          <CopyIcon />
        </FeedbackButton>
      </div>
      <FieldDescription>
        {t("Register this redirect URI with the provider.")}
      </FieldDescription>
    </Field>
  )
}

export function providerFieldId(field: string, providerId: string | null) {
  return providerId ? `${field}-${providerId}` : `new-${field}`
}

function tokenAuthMethodLabel(method: OAuthTokenAuthMethod) {
  if (method === OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD) {
    return t("Client secret basic")
  }
  return t("Client secret post")
}
