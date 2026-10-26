import { t } from "@alloy/contracts/schema"
import { cn } from "@alloy/ui/lib/utils"
import type { ReactNode } from "react"

import { useRegisterSettingsSection } from "@/components/routes/settings/settings-sections-context"

const NavigationLabelSchema = t.string()

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
  /** Optional button for the section, e.g. the one that adds to its list. */
  action?: ReactNode
  children: ReactNode
}) {
  const titleLabel = NavigationLabelSchema.safeParse(title)
  const register = useRegisterSettingsSection(
    id,
    navLabel ?? (titleLabel.success ? titleLabel.data : null),
  )

  return (
    <section
      id={`settings-section-${id}`}
      ref={register}
      className="flex scroll-mt-6 flex-col gap-4 sm:scroll-mt-8"
    >
      <SettingsIntro action={action}>
        <h3 className="text-foreground text-lg font-semibold tracking-[var(--tracking-tight)]">
          {title}
        </h3>
        {description ? (
          <p className="text-foreground-dim">{description}</p>
        ) : null}
      </SettingsIntro>
      {children}
    </section>
  )
}

/**
 * Copy with the button that acts on what it describes, such as a section's
 * heading and description and its create button. In a narrow panel the button
 * takes the full row under the copy, so its label never fights the text for
 * width; once the panel has room it moves beside the copy, centered on all of
 * it. Section actions use the secondary button style; primary is reserved for
 * submitting a dialog or the save bar.
 */
export function SettingsIntro({
  children,
  action,
}: {
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="text-foreground-muted @container">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-6">
        {children ? (
          <div className="flex min-w-0 flex-col gap-1 text-sm">{children}</div>
        ) : null}
        {action ? (
          <div className="shrink-0 [&>button]:w-full @xl:[&>button]:w-auto">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  )
}
