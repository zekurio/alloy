import { useMemo } from "react"
import { cva } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import type { VariantProps } from "class-variance-authority"

function FieldStateMarker({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-slot="field-state-marker"
      className="inline-flex items-center rounded-full bg-surface-raised px-1.5 py-0.5 text-2xs font-medium tracking-[0.06em] text-foreground-muted uppercase"
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
        className="text-base leading-5 font-semibold text-foreground-muted transition-colors group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[invalid=true]/field:text-destructive"
      >
        *
      </span>
      <span className="sr-only"> required</span>
    </>
  )
}

function FieldHeaderContent({
  children,
  optional,
  required,
}: {
  children: React.ReactNode
  optional?: boolean
  required?: boolean
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0">{children}</span>
        {required ? <FieldRequiredMarker /> : null}
      </span>
      {optional ? <FieldStateMarker>Optional</FieldStateMarker> : null}
    </>
  )
}

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  children,
  required,
  optional,
  ...props
}: React.ComponentProps<"legend"> & {
  variant?: "legend" | "label"
  required?: boolean
  optional?: boolean
}) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-1.5 flex items-center gap-2.5 font-semibold tracking-[-0.01em] text-foreground group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[invalid=true]/field:text-destructive data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className
      )}
      {...props}
    >
      <FieldHeaderContent required={required} optional={optional}>
        {children}
      </FieldHeaderContent>
    </legend>
  )
}

function FieldSection({
  className,
  slot,
  ...props
}: React.ComponentProps<"div"> & {
  slot: string
}) {
  return <div data-slot={slot} className={cn(className)} {...props} />
}

function renderFieldSection(
  slot: string,
  defaultClassName: string,
  { className, ...props }: React.ComponentProps<"div">
) {
  return (
    <FieldSection
      slot={slot}
      className={cn(defaultClassName, className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return renderFieldSection(
    "field-group",
    "group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
    { className, ...props }
  )
}

const fieldVariants = cva(
  "group/field flex w-full gap-2 data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return renderFieldSection(
    "field-content",
    "group/field-content flex flex-1 flex-col gap-1.5 leading-tight",
    { className, ...props }
  )
}

function FieldLabel({
  className,
  children,
  required,
  optional,
  ...props
}: React.ComponentProps<typeof Label> & {
  required?: boolean
  optional?: boolean
}) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit items-center gap-2.5 leading-tight group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[disabled=true]/field:opacity-50 group-data-[invalid=true]/field:text-destructive has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:border-border *:data-[slot=field]:p-3 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    >
      <FieldHeaderContent required={required} optional={optional}>
        {children}
      </FieldHeaderContent>
    </Label>
  )
}

function FieldTitle({
  className,
  children,
  required,
  optional,
  ...props
}: React.ComponentProps<"div"> & {
  required?: boolean
  optional?: boolean
}) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2.5 text-sm font-semibold tracking-[-0.01em] text-foreground group-has-[:user-invalid]/field:text-destructive group-has-[[aria-invalid=true]]/field:text-destructive group-data-[disabled=true]/field:opacity-50 group-data-[invalid=true]/field:text-destructive",
        className
      )}
      {...props}
    >
      <FieldHeaderContent required={required} optional={optional}>
        {children}
      </FieldHeaderContent>
    </div>
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-left text-sm leading-relaxed font-normal text-foreground-muted group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
        "last:mt-0 nth-last-2:-mt-1",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children ? (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      ) : null}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
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
      if (typeof error === "string") {
        return [{ message: error }]
      }

      if (error instanceof Error) {
        return [{ message: error.message }]
      }

      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
      ) {
        return [{ message: error.message }]
      }

      return []
    })

    const uniqueErrors = [
      ...new Map(
        normalizedErrors.map((error) => [error.message ?? "", error])
      ).values(),
    ]

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
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
        className
      )}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
