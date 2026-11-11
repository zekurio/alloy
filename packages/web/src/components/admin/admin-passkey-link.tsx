import type { PasskeyEnrollmentLink } from "@alloy/contracts"
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
} from "@alloy/ui/components/responsive-dialog"
import { useMutation } from "@tanstack/react-query"
import { CopyIcon, LinkIcon } from "lucide-react"

import { api } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

import type { AdminUserRow } from "./admin-user-data"

/**
 * A passkey link that was just made, with a button to copy it. The server
 * keeps only its hash, so this is the one time it can be read.
 */
export function PasskeyLinkResult({
  username,
  link,
}: {
  username: string
  link: PasskeyEnrollmentLink
}) {
  const copyFeedback = useActionFeedback()
  const copy = () =>
    copyFeedback.run(async () => {
      if (!(await copyTextToClipboard(link.url, { action: "copy link" }))) {
        throw new Error(t("Couldn't copy link"))
      }
    }, t("Couldn't copy link"))

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {t("Passkey link for {username}", { username })}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t(
            "Send them this link. It lets them add a passkey and sign in. It works once, for 7 days, and you can't see it again after closing this.",
          )}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody className="flex flex-col gap-3">
        <code className="bg-surface-sunken text-foreground block rounded-md p-3 font-mono text-sm break-all select-all">
          {link.url}
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

/**
 * Makes a passkey link for an account: the way in for one that has no
 * sign-in method yet, and back in for one whose passkeys are lost.
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
  const create = useMutation({
    mutationFn: () => api.admin.createPasskeyLink(user.id),
  })
  const error = create.error
    ? errorMessage(create.error, t("Couldn't create the passkey link"))
    : null

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        // The link shows once, so a reopened dialog starts over.
        if (!next) create.reset()
      }}
    >
      <ResponsiveDialogContent variant="secondary">
        {create.data ? (
          <PasskeyLinkResult username={user.username} link={create.data} />
        ) : (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {t("Create a passkey link for {username}?", {
                  username: user.username,
                })}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {t(
                  "Whoever opens the link can add a passkey to this account and sign in. It replaces any earlier link for this account.",
                )}
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
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={create.isPending}
                  />
                }
              >
                {t("Cancel")}
              </ResponsiveDialogClose>
              <FeedbackButton
                type="button"
                state={create.isPending ? "pending" : error ? "error" : "idle"}
                pendingLabel={t("Creating…")}
                errorLabel={t("Try again")}
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                <LinkIcon />
                {t("Create link")}
              </FeedbackButton>
            </ResponsiveDialogFooter>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
