import type { PasskeyLink } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { FieldError } from "@alloy/ui/components/field"
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
import { useMutation } from "@tanstack/react-query"
import { CopyIcon, LinkIcon, UserPlusIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

import { api } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

import type { AdminUserRow } from "./admin-user-data"

type LinkCopy = {
  /** Asks before making the link. */
  confirmTitle: string
  confirmDescription: string
  /** Shown with the link once it exists. */
  resultTitle: string
  resultDescription: string
}

/**
 * Asks before making a passkey link, then shows it with a button to copy it.
 * The server keeps only the link's hash, so this is the one time it can be
 * read. Lives inside the dialog content, so each open starts over.
 */
function PasskeyLinkFlow({
  copy,
  create,
}: {
  copy: LinkCopy
  create: () => Promise<PasskeyLink>
}) {
  const link = useMutation({ mutationFn: create })
  const error = link.error
    ? errorMessage(link.error, t("Couldn't create the link"))
    : null

  if (link.data) {
    return (
      <PasskeyLinkResult
        title={copy.resultTitle}
        description={copy.resultDescription}
        url={link.data.url}
      />
    )
  }
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{copy.confirmTitle}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {copy.confirmDescription}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {error ? (
        <ResponsiveDialogBody>
          <FieldError>{error}</FieldError>
        </ResponsiveDialogBody>
      ) : null}
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose
          render={
            <Button type="button" variant="ghost" disabled={link.isPending} />
          }
        >
          {t("Cancel")}
        </ResponsiveDialogClose>
        <FeedbackButton
          type="button"
          state={link.isPending ? "pending" : error ? "error" : "idle"}
          pendingLabel={t("Creating…")}
          errorLabel={t("Try again")}
          disabled={link.isPending}
          onClick={() => link.mutate()}
        >
          <LinkIcon />
          {t("Create link")}
        </FeedbackButton>
      </ResponsiveDialogFooter>
    </>
  )
}

function PasskeyLinkResult({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  const copyFeedback = useActionFeedback()
  const copy = () =>
    copyFeedback.run(async () => {
      if (!(await copyTextToClipboard(url, { action: "copy link" }))) {
        throw new Error(t("Couldn't copy link"))
      }
    }, t("Couldn't copy link"))

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody className="flex flex-col gap-3">
        <code className="bg-surface-sunken text-foreground block rounded-md p-3 font-mono text-sm break-all select-all">
          {url}
        </code>
        <FieldError>
          {copyFeedback.feedback.state === "error"
            ? copyFeedback.feedback.message
            : null}
        </FieldError>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose
          render={<Button type="button" variant="ghost" />}
        >
          {t("Done")}
        </ResponsiveDialogClose>
        <FeedbackButton
          type="button"
          state={copyFeedback.feedback.state}
          pendingLabel={t("Copying…")}
          successLabel={t("Copied")}
          errorLabel={t("Try again")}
          onClick={() => void copy()}
        >
          <CopyIcon />
          {t("Copy link")}
        </FeedbackButton>
      </ResponsiveDialogFooter>
    </>
  )
}

function PasskeyLinkDialogContent({ children }: { children: ReactNode }) {
  return (
    <ResponsiveDialogContent variant="secondary">
      {children}
    </ResponsiveDialogContent>
  )
}

/**
 * Makes an invite: a link that lets one person create an account with a
 * username and a passkey, also while registrations are closed.
 */
export function InviteDialog() {
  const [open, setOpen] = useState(false)

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            aria-label={t("Invite someone")}
          >
            <UserPlusIcon />
          </Button>
        }
      />
      <PasskeyLinkDialogContent>
        <PasskeyLinkFlow
          create={() => api.admin.createInvite()}
          copy={{
            confirmTitle: t("Invite someone"),
            confirmDescription: t(
              "Create a link that lets one person make an account here with a username and a passkey.",
            ),
            resultTitle: t("Invite link"),
            resultDescription: t(
              "Send this link to the person you're inviting. It works once, for 7 days, and you can't see it again after closing this.",
            ),
          }}
        />
      </PasskeyLinkDialogContent>
    </ResponsiveDialog>
  )
}

/**
 * Makes a passkey link for an account, for someone who lost their passkeys.
 */
export function PasskeyLinkDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { username } = user

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <PasskeyLinkDialogContent>
        <PasskeyLinkFlow
          create={() => api.admin.createPasskeyLink(user.id)}
          copy={{
            confirmTitle: t("Create a passkey link for {username}?", {
              username,
            }),
            confirmDescription: t(
              "Whoever opens the link can add a passkey to this account and sign in. It replaces any earlier link for this account.",
            ),
            resultTitle: t("Passkey link for {username}", { username }),
            resultDescription: t(
              "Send them this link. It lets them add a passkey and sign in. It works once, for 7 days, and you can't see it again after closing this.",
            ),
          }}
        />
      </PasskeyLinkDialogContent>
    </ResponsiveDialog>
  )
}
