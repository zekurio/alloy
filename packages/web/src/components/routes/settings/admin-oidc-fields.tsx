import type { OAuthTokenAuthMethod } from "@alloy/api"
import {
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Input } from "@alloy/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import { cn } from "@alloy/ui/lib/utils"
import { CopyIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { copyTextToClipboard } from "@/lib/clipboard"
import { useActionFeedback } from "@/lib/use-action-feedback"

import {
  type ResetToDefault,
  ResettableSelectTrigger,
} from "./admin-reset-default"

const TOKEN_AUTH_METHODS = [
  OAUTH_CLIENT_SECRET_POST_AUTH_METHOD,
  OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD,
] as const

/** A setting edited in a text input, with the input on the right. */
export function TextRow({
  id,
  title,
  description,
  footer,
  value,
  onChange,
  wide = false,
  ...props
}: {
  id: string
  title: string
  description?: ReactNode
  footer?: ReactNode
  value: string
  onChange: (value: string) => void
  /** URLs get the wide input; names and claims fit the narrow one. */
  wide?: boolean
} & Omit<
  ComponentProps<typeof Input>,
  "id" | "value" | "onChange" | "className"
>) {
  return (
    <SettingRow
      title={title}
      description={description}
      footer={footer}
      htmlFor={id}
      stack
    >
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn("w-full", wide ? "@lg:w-96" : "@lg:w-56")}
        {...props}
      />
    </SettingRow>
  )
}

export function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <SettingRow title={title} description={description} align="start">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </SettingRow>
  )
}

export function TokenAuthMethodRow({
  id,
  value,
  reset,
  onChange,
}: {
  id: string
  value: OAuthTokenAuthMethod
  reset: ResetToDefault<OAuthTokenAuthMethod>
  onChange: (value: OAuthTokenAuthMethod) => void
}) {
  return (
    <SettingRow
      title={t("Token auth method")}
      description={t(
        "How Alloy sends the client secret to the token endpoint.",
      )}
      htmlFor={id}
      stack
    >
      <Select
        value={value}
        onValueChange={(next) => {
          const method = TOKEN_AUTH_METHODS.find((option) => option === next)
          if (method) onChange(method)
        }}
      >
        <ResettableSelectTrigger
          reset={reset}
          id={id}
          size="sm"
          className="w-full @lg:w-56"
        >
          <SelectValue>{tokenAuthMethodLabel(value)}</SelectValue>
        </ResettableSelectTrigger>
        <SelectContent align="end">
          {TOKEN_AUTH_METHODS.map((method) => (
            <SelectItem key={method} value={method}>
              {tokenAuthMethodLabel(method)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

export function CallbackUrlRow({ id, value }: { id: string; value: string }) {
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
    <SettingRow
      title={t("Callback URL")}
      description={
        <>
          {t("Register this redirect URI with the provider.")}
          <code
            id={id}
            className="text-foreground mt-1 block font-mono break-all select-all"
          >
            {value}
          </code>
        </>
      }
      align="start"
    >
      <FeedbackButton
        type="button"
        variant="outline"
        size="icon"
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
    </SettingRow>
  )
}

export function tokenAuthMethodLabel(method: OAuthTokenAuthMethod) {
  if (method === OAUTH_CLIENT_SECRET_BASIC_AUTH_METHOD) {
    return t("Client secret basic")
  }
  return t("Client secret post")
}
