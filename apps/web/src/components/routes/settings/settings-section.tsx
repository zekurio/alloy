import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

interface SettingsSectionProps {
  icon?: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  defaultOpen = false,
}: SettingsSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-md border border-border bg-surface"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]">
        {Icon && <Icon className="mt-0.5 size-[18px] shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {description && (
            <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
          )}
        </div>
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-foreground-dim transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-4 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
