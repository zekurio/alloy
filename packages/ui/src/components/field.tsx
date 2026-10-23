import { messageFromUnknown } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Label } from "@alloy/ui/components/label"
import { cn } from "@alloy/ui/lib/utils"
import { useMemo } from "react"
import type { ComponentProps, ReactNode } from "react"

function FieldStateMarker({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="field-state-marker"
      className="bg-surface-raised text-2xs text-foreground-muted inline-flex items-center rounded-full px-1.5 py-0.5 font-medium tracking-[0.06em] uppercase"
    >
      {children}
    </span>
  )
}

function FieldRequiredMarker() {
  return (
    <>
      <span
        aria-hidden="true"
        data-slot="field-required-marker"
        className="text-foreground-muted group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[invalid=true]/field:text-destructive text-base leading-none font-semibold transition-colors"
      >
        {"*"}
      </span>
      <span className="sr-only">{t("required")}</span>
    </>
  )
}

function FieldHeaderContent({
  children,
  optional,
  required,
}: {
  children: ReactNode
  optional?: boolean
  required?: boolean
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0">{children}</span>
        {required ? <FieldRequiredMarker /> : null}
      </span>
      {optional ? <FieldStateMarker>{t("Optional")}</FieldStateMarker> : null}
    </>
  )
}

function Field({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn(
        "group/field flex w-full flex-col gap-2 data-[invalid=true]:text-destructive *:w-full [&>.sr-only]:w-auto",
        className,
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  children,
  required,
  optional,
  ...props
}: ComponentProps<typeof Label> & {
  required?: boolean
  optional?: boolean
}) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit items-center gap-2.5 leading-tight group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[disabled=true]/field:opacity-50 group-data-[invalid=true]/field:text-destructive has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:border-border *:data-[slot=field]:p-3 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className,
      )}
      {...props}
    >
      <FieldHeaderContent required={required} optional={optional}>
        {children}
      </FieldHeaderContent>
    </Label>
  )
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-left text-sm leading-relaxed font-normal text-foreground-muted group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
        "last:mt-0 nth-last-2:-mt-1",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className,
      )}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: ComponentProps<"div"> & {
  errors?: Array<unknown>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const normalizedErrors = errors.flatMap((error) => {
      const message = messageFromUnknown(error)
      return message ? [{ message }] : []
    })

    const uniqueErrors = [
      ...new Map(
        normalizedErrors.map((error) => [error.message ?? "", error]),
      ).values(),
    ]

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn(
        "text-sm leading-normal font-medium text-destructive",
        className,
      )}
      {...props}
    >
      {content}
    </div>
  )
}

export { Field, FieldDescription, FieldError, FieldLabel }
