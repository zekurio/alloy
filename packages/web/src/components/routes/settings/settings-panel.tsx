import { cn } from "@alloy/ui/lib/utils"
import type { ReactNode } from "react"

import { useRegisterSettingsSection } from "@/components/routes/settings/settings-sections-context"

/**
 * Stacks the subsections of a panel. Sections are separated by whitespace and
 * heading weight alone: the only rules in a panel are the hairlines between
 * adjacent rows, so every visible divider has the same spacing around it.
 */
export function SettingsSections({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("flex flex-col gap-10", className)}>{children}</div>
}

/**
 * A titled block within a settings page. Registers itself with
 * {@link SettingsSectionsProvider} so the sidebar can list it under the active
 * category, which is why `id` has to be stable and unique within its panel.
 */
export function SettingsSubsection({
  id,
  title,
  navLabel,
  description,
  action,
  children,
}: {
  id: string
  title: ReactNode
  /** Sidebar label; defaults to `title` when that is plain text. */
  navLabel?: string
  description?: ReactNode
  /** Optional control rendered to the right of the header. */
  action?: ReactNode
  children: ReactNode
}) {
  const register = useRegisterSettingsSection(
    id,
    navLabel ?? (typeof title === "string" ? title : null),
  )

  return (
    <section
      id={`settings-section-${id}`}
      ref={register}
      className="flex scroll-mt-6 flex-col gap-4 sm:scroll-mt-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-foreground text-lg font-semibold tracking-[var(--tracking-tight)]">
            {title}
          </h3>
          {description ? (
            <p className="text-foreground-dim text-sm">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
